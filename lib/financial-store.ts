import { all, one, run, sha, db } from "../db/repository";
import type { Metric } from "./domain";
import { financialUnit, normalizeFinancialValue } from "./financial-units";
import { headlineMetrics } from "./financial-definitions";
import { PDF_LAYOUT_VERSION } from "./pdf-financials";
import { STRUCTURED_VERSION } from "./structured-financials";
import type { FinancialFact } from "./structured-financials";
export const financialExtractorVersion =
  PDF_LAYOUT_VERSION + ":" + STRUCTURED_VERSION + ":prose_calendar_v2";
export async function prepareFinancialMetric(
  ticker: string,
  documentId: string,
  m: Omit<Metric, "id" | "ticker" | "document_id">,
  method: string,
  idIncludesUnit = false,
) {
  if (m.value === null || !Number.isFinite(m.value)) return null;
  const originalValue = m.original_value ?? m.value,
    originalUnit = m.original_unit ?? m.unit,
    u = financialUnit(originalUnit, /EPS/.test(m.name));
  if (!u) {
    await metricState(
      documentId,
      m.name,
      "Insufficient evidence",
      m.period,
      m.basis,
      "unit_ambiguous",
      "Currency and reporting scale could not be established.",
    );
    return null;
  }
  const value = normalizeFinancialValue(originalValue, u);
  if (value === null) return null;
  const id = await sha(
      `${ticker}:${m.name}:${m.period}:${m.basis}:${idIncludesUnit ? m.unit + ":" : ""}${documentId}`,
    ),
    now = new Date().toISOString();
  const statement = db()
    .prepare(
      `INSERT INTO financial_metrics(id,ticker,name,value,period,unit,basis,document_id,page,currency,scale,fiscal_year,fiscal_quarter,period_start,period_end,period_kind,original_value,original_unit,original_currency,original_scale,normalized_value,normalized_unit,evidence_text,evidence_location,extraction_method,verification_status,extraction_context,updated_at,reporting_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,unit=excluded.unit,currency=excluded.currency,scale=excluded.scale,evidence_text=excluded.evidence_text,page=excluded.page,evidence_location=excluded.evidence_location,original_value=excluded.original_value,original_unit=excluded.original_unit,original_currency=excluded.original_currency,original_scale=excluded.original_scale,normalized_value=excluded.normalized_value,normalized_unit=excluded.normalized_unit,extraction_context=excluded.extraction_context,verification_status=excluded.verification_status,extraction_method=excluded.extraction_method,reporting_status=excluded.reporting_status,updated_at=excluded.updated_at`,
    )
    .bind(
      id,
      ticker,
      m.name,
      value,
      m.period,
      u.normalized_unit,
      m.basis,
      documentId,
      m.page,
      u.currency,
      u.normalized_unit.split(" ")[1] ?? u.scale,
      Number(m.period.match(/FY(\d{4})/)?.[1]) || null,
      Number(m.period.match(/^Q([1-4])/)?.[1]) || null,
      m.period_start ?? null,
      m.period_end ?? null,
      m.period_kind ?? "duration",
      originalValue,
      originalUnit,
      u.currency,
      u.scale,
      value,
      u.normalized_unit,
      m.evidence_text ?? "",
      m.evidence_location ?? `PDF page ${m.page}`,
      method,
      m.verification_status ?? "source_checked",
      m.extraction_context ?? null,
      now,
      m.reporting_status ?? "reported",
    );
  return { id, statement };
}
export async function metricState(
  documentId: string,
  name: string,
  state: string,
  period = "unknown",
  basis = "",
  errorCode: string | null = null,
  detail: string | null = null,
) {
  await run(
    "INSERT INTO metric_processing(document_id,name,period,basis,state,error_code,detail,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(document_id,name,period,basis) DO UPDATE SET state=excluded.state,error_code=excluded.error_code,detail=excluded.detail,updated_at=excluded.updated_at",
    documentId,
    name,
    period,
    basis,
    state,
    errorCode,
    detail,
    new Date().toISOString(),
  );
}
export async function startMetricExtraction(documentId: string) {
  const d = await one<{ period: string }>(
    "SELECT period FROM documents WHERE id=?",
    documentId,
  );
  for (const name of headlineMetrics)
    await metricState(documentId, name, "Extracting", d?.period ?? "unknown");
}
export async function finishMetricExtraction(
  documentId: string,
  failedCode?: string,
) {
  const metrics = await all<Metric>(
    "SELECT * FROM financial_metrics WHERE document_id=? AND verification_status<>'unverified'",
    documentId,
  );
  const chunks = await all<{ text: string }>(
    "SELECT text FROM document_chunks WHERE document_id=?",
    documentId,
  );
  const document = await one<{
    period: string;
    extraction_status: string;
    indexed_pages: number;
    total_pages: number;
  }>(
    "SELECT period,extraction_status,indexed_pages,total_pages FROM documents WHERE id=?",
    documentId,
  );
  const text = chunks.map((c) => c.text).join(" ");
  for (const name of headlineMetrics) {
    const accepted = metrics.filter((m) => m.name === name && m.value !== null);
    if (accepted.length) {
      for (const m of accepted)
        await metricState(documentId, name, "Verified", m.period, m.basis);
      continue;
    }
    const mentioned = (
      name === "Revenue"
        ? /revenue|sales/i
        : name === "PBT"
          ? /before tax|\bPBT\b/i
          : name === "PAT"
            ? /after tax|profit (?:for|loss for|\(loss\) for)|\bPAT\b/i
            : /\bEBITDA\b|earnings before interest.{0,40}depreciation/i
    ).test(text);
    const checked =
      document?.extraction_status === "complete" &&
      document.indexed_pages === document.total_pages;
    const state =
      failedCode && mentioned
        ? "Extraction failed"
        : !failedCode && checked && !mentioned
          ? "Not disclosed in checked sources"
          : "Insufficient evidence";
    await metricState(
      documentId,
      name,
      state,
      document?.period ?? "unknown",
      "",
      failedCode && mentioned ? failedCode : null,
    );
  }
}
/** Each original fact is retained alongside a deterministic display-unit conversion. */
export async function persistStructuredFacts(
  ticker: string,
  documentId: string,
  facts: FinancialFact[],
) {
  const now = new Date().toISOString(),
    statements = [
      db()
        .prepare(
          "UPDATE financial_metrics SET verification_status='unverified' WHERE document_id=? AND extraction_method LIKE 'structured_financial_%'",
        )
        .bind(documentId),
    ],
    accepted: FinancialFact[] = [];
  for (const f of facts) {
    await metricState(
      documentId,
      f.name,
      "Extracted, awaiting validation",
      f.period,
      f.basis,
    );
    const unit = financialUnit(f.original_unit, /EPS/.test(f.name));
    if (
      !unit ||
      normalizeFinancialValue(f.original_value, unit) !== f.value ||
      !f.evidence_location ||
      !f.evidence_text
    ) {
      await metricState(
        documentId,
        f.name,
        "Extraction failed",
        f.period,
        f.basis,
        "source_verification_failed",
        "Original value, reporting unit and normalized value did not reconcile.",
      );
      continue;
    }
    accepted.push(f);
    const id = await sha(
      `${ticker}:${f.name}:${f.period}:${f.basis}:${documentId}:structured`,
    );
    statements.push(
      db()
        .prepare(
          `INSERT INTO financial_metrics(id,ticker,name,value,period,unit,basis,document_id,page,currency,scale,fiscal_year,fiscal_quarter,period_start,period_end,period_kind,original_value,original_unit,original_currency,original_scale,normalized_value,normalized_unit,evidence_text,evidence_location,extraction_method,verification_status,extraction_context,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,unit=excluded.unit,evidence_text=excluded.evidence_text,evidence_location=excluded.evidence_location,verification_status=excluded.verification_status,updated_at=excluded.updated_at,extraction_method=excluded.extraction_method,extraction_context=excluded.extraction_context,original_value=excluded.original_value,original_unit=excluded.original_unit,original_currency=excluded.original_currency,original_scale=excluded.original_scale,normalized_value=excluded.normalized_value,normalized_unit=excluded.normalized_unit`,
        )
        .bind(
          id,
          ticker,
          f.name,
          f.value,
          f.period,
          f.unit,
          f.basis,
          documentId,
          f.page,
          f.currency,
          f.scale,
          Number(f.period.match(/FY(\d{4})/)?.[1]) || null,
          Number(f.period.match(/^Q([1-4])/)?.[1]) || null,
          f.period_start,
          f.period_end,
          f.period_kind,
          f.original_value,
          f.original_unit,
          f.original_currency,
          f.original_scale,
          f.value,
          f.unit,
          f.evidence_text,
          f.evidence_location,
          f.extraction_method,
          f.verification_status,
          f.extraction_context,
          now,
        ),
    );
  }
  // D1 batch is atomic: a failed write never leaves a half-written financial statement.
  if (statements.length) await db().batch(statements);
  for (const f of accepted)
    await metricState(documentId, f.name, "Verified", f.period, f.basis);
  return accepted.length;
}
export async function normalizeStoredMetric(id: string) {
  const row = await one<Metric>(
    "SELECT * FROM financial_metrics WHERE id=?",
    id,
  );
  if (
    !row ||
    row.value === null ||
    (row.original_value !== null && row.original_value !== undefined)
  )
    return;
  const u = financialUnit(row.unit, /EPS/.test(row.name));
  if (!u) {
    await metricState(
      row.document_id,
      row.name,
      "Insufficient evidence",
      row.period,
      row.basis,
      "unit_ambiguous",
      "The source currency/scale could not be verified.",
    );
    await run(
      "UPDATE financial_metrics SET verification_status='unverified' WHERE id=?",
      id,
    );
    await run(
      "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      row.document_id,
      "unit_normalization_v1",
      "review",
      "A previously accepted unit could not be canonicalized; original record retained for source review.",
      new Date().toISOString(),
    );
    return;
  }
  const value = normalizeFinancialValue(row.value, u);
  if (value === null) return;
  await run(
    "UPDATE financial_metrics SET original_value=value,original_unit=unit,original_currency=?,original_scale=?,normalized_value=?,normalized_unit=?,value=?,unit=?,currency=?,scale=? WHERE id=? AND original_value IS NULL",
    u.currency,
    u.scale,
    value,
    u.normalized_unit,
    value,
    u.normalized_unit,
    u.currency,
    u.normalized_unit.split(" ")[1] ?? u.scale,
    id,
  );
}
export async function saveMetricMetadata(
  id: string,
  m: Omit<Metric, "id" | "ticker" | "document_id">,
) {
  if (m.original_value === null || m.original_value === undefined) {
    await normalizeStoredMetric(id);
    await run(
      "UPDATE financial_metrics SET evidence_location=coalesce(?,evidence_location),extraction_context=coalesce(?,extraction_context) WHERE id=?",
      m.evidence_location ?? null,
      m.extraction_context ?? null,
      id,
    );
    return;
  }
  await run(
    "UPDATE financial_metrics SET original_value=?,original_unit=?,original_currency=?,original_scale=?,normalized_value=?,normalized_unit=?,evidence_location=?,period_kind=?,period_start=?,period_end=?,extraction_context=?,currency=?,scale=?,unit=? WHERE id=?",
    m.original_value,
    m.original_unit ?? m.unit,
    m.original_currency ?? m.currency ?? null,
    m.original_scale ?? m.scale ?? null,
    m.normalized_value ?? m.value,
    m.normalized_unit ?? m.unit,
    m.evidence_location ?? `PDF page ${m.page}`,
    m.period_kind ?? "duration",
    m.period_start ?? null,
    m.period_end ?? null,
    m.extraction_context ?? null,
    m.currency ?? null,
    m.scale ?? null,
    m.unit,
    id,
  );
}
