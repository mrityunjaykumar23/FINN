import { sortPeriods } from "../periods";
import {
  financialContexts,
  explicitFinancialPeriod,
} from "../financial-context";
import { financialError } from "../financial-errors";
import { parseStructuredFinancials } from "../structured-financials";
import {
  prepareFinancialMetric,
  financialExtractorVersion,
  persistStructuredFacts,
  startMetricExtraction,
  finishMetricExtraction,
  normalizeStoredMetric,
} from "../financial-store";
import {
  PDF_LAYOUT_VERSION,
  extractPdfFinancials,
  type PdfLayout,
} from "../pdf-financials";
import financialSources from "../../data/financial-sources.json";
import { env } from "cloudflare:workers";
import {
  all,
  one,
  run,
  budget,
  db,
  lock,
  unlock,
  sha,
  ApiError,
} from "../../db/repository";
import {
  aiStatus,
  geminiTransport,
  PROMPT_VERSION,
  AiFailure,
  modelForTask,
  type AiConfig,
} from "./gemini";
import {
  analyzeCompanyResearch,
  extractFinancialMetrics,
  classifyAnnouncement,
  type Source,
} from "./provider";
import {
  extractReportedProse,
  extractExplicitTables,
  extractionPassages,
} from "../financial-extraction";
import type { Metric } from "../domain";

export const config = () => env as unknown as AiConfig;
export const providerStatus = () => aiStatus(config());
export async function aiTask<T>(
  task: string,
  ticker: string,
  data: unknown,
  execute: (model: string) => Promise<T>,
): Promise<T> {
  const c = config(),
    model = modelForTask(c, task, (data as { question?: string })?.question);
  if (!providerStatus().enabled || !model)
    throw new AiFailure("not_configured");
  const key = await sha(
    JSON.stringify({ task, ticker, data, model, prompt: PROMPT_VERSION }),
  );
  await run(
    "DELETE FROM analysis_cache WHERE key IN (SELECT key FROM analysis_cache WHERE expires_at<? LIMIT 40)",
    new Date().toISOString(),
  );
  const cached = await one<{ payload: string }>(
    "SELECT payload FROM analysis_cache WHERE key=? AND expires_at>?",
    key,
    new Date().toISOString(),
  );
  const start = Date.now(),
    id = crypto.randomUUID();
  if (cached) {
    await run(
      "INSERT INTO ai_operations(id,ticker,task,model,status,created_at,cache_hit) VALUES (?,?,?,?,?,?,1)",
      id,
      ticker,
      task,
      model,
      "success",
      new Date().toISOString(),
    );
    return JSON.parse(cached.payload) as T;
  }
  if (!(await lock(`ai:${key}`, 90000)))
    throw new AiFailure("request_in_progress");
  let slot: string | null = null;
  try {
    // Persisted global cap still applies when callers manufacture new anonymous sessions.
    await budget("gemini:global:day", 100, 86400000);
    await budget("gemini:global:hour", 30);
    for (const s of ["ai:slot:0", "ai:slot:1"])
      if (await lock(s, 90000)) {
        slot = s;
        break;
      }
    if (!slot) throw new AiFailure("concurrency_limit");
    const result = await execute(model);
    const usage = (
      result as { usage?: { input_tokens: number; output_tokens: number } }
    ).usage;
    await run(
      "INSERT INTO analysis_cache(key,payload,created_at,expires_at,ticker,model,prompt_version,kind) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at",
      key,
      JSON.stringify(result),
      new Date().toISOString(),
      new Date(Date.now() + 86400000 * 7).toISOString(),
      ticker,
      model,
      PROMPT_VERSION,
      task,
    );
    await run(
      "INSERT INTO ai_operations(id,ticker,task,model,status,created_at,duration_ms,input_tokens,output_tokens) VALUES (?,?,?,?,?,?,?,?,?)",
      id,
      ticker,
      task,
      model,
      "success",
      new Date().toISOString(),
      Date.now() - start,
      usage?.input_tokens ?? 0,
      usage?.output_tokens ?? 0,
    );
    return result;
  } catch (e) {
    const code =
      e instanceof AiFailure || e instanceof ApiError
        ? e.code
        : "validation_failed";
    await run(
      "INSERT INTO ai_operations(id,ticker,task,model,status,created_at,duration_ms,error_code) VALUES (?,?,?,?,?,?,?,?)",
      id,
      ticker,
      task,
      model,
      "failed",
      new Date().toISOString(),
      Date.now() - start,
      code,
    );
    throw new AiFailure(code);
  } finally {
    if (slot) await unlock(slot);
    await unlock(`ai:${key}`);
  }
}
export async function synthesizeResearch(
  ticker: string,
  question: string,
  sources: Source[],
  metrics: Metric[],
  calculated: string[],
) {
  // Evidence prose is already supplied as bounded source passages. Repeating complete pages
  // once per metric can exceed the native provider budget even for a small company.
  const boundedMetrics = metrics
    .filter((m) =>
      sources.some((s) => s.document_id === m.document_id && s.page === m.page),
    )
    .slice(0, 80)
    .map((m) => ({
      id: m.id,
      ticker: m.ticker,
      name: m.name,
      value: m.value,
      period: m.period,
      unit: m.unit,
      basis: m.basis,
      document_id: m.document_id,
      page: m.page,
      currency: m.currency,
      scale: m.scale,
      verification_status: m.verification_status,
    }));
  const input = {
    ticker,
    question,
    sources,
    metrics: boundedMetrics,
    calculated,
  };
  const result = await aiTask("research", ticker, input, (model) =>
    analyzeCompanyResearch(geminiTransport(config()), model, input),
  );
  return {
    ...result,
    model_used: modelForTask(config(), "research", question)!,
  };
}
export async function extractDocument(
  ticker: string,
  documentId: string,
  options: { preferDeterministic?: boolean; deterministicOnly?: boolean } = {},
) {
  await startMetricExtraction(documentId);
  try {
    const result = await extractDocumentWork(ticker, documentId, options);
    const metrics = await all<{ id: string }>(
      "SELECT id FROM financial_metrics WHERE document_id=? AND verification_status<>'unverified' AND original_value IS NULL",
      documentId,
    );
    for (const m of metrics) await normalizeStoredMetric(m.id);
    const error = /failed|error|rejected/.test(result.status)
      ? financialError(
          {
            message:
              "error_code" in result
                ? String(result.error_code)
                : result.status,
          },
          "extraction",
        ).code
      : undefined;
    await finishMetricExtraction(documentId, error);
    await run(
      "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
      `financial-checked:${documentId}`,
      financialExtractorVersion,
    );
    return result;
  } catch (e) {
    const failure = financialError(e, "extraction");
    await run(
      "UPDATE metric_processing SET state='Extraction failed',error_code=?,detail=?,updated_at=? WHERE document_id=? AND state IN ('Extracting','Extracted, awaiting validation')",
      failure.code,
      failure.message,
      new Date().toISOString(),
      documentId,
    );
    await finishMetricExtraction(documentId, failure.code);
    throw e;
  }
}
async function extractDocumentWork(
  ticker: string,
  documentId: string,
  options: { preferDeterministic?: boolean; deterministicOnly?: boolean } = {},
) {
  const payload = await one<{ raw: string }>(
    "SELECT raw FROM source_payloads WHERE document_id=?",
    documentId,
  );
  if (payload) {
    const company = await one<{ name: string }>(
      "SELECT name FROM companies WHERE ticker=?",
      ticker,
    );
    const parsed = parseStructuredFinancials(payload.raw, {
      ticker,
      name: company?.name ?? ticker,
    });
    const count = await persistStructuredFacts(
      ticker,
      documentId,
      parsed.facts,
    );
    await finishMetricExtraction(documentId);
    return {
      metrics: count,
      guidance: 0,
      status: "verified_structured_financials",
      ai_status: "not_required",
    };
  }
  const chunks = await all<Source>(
    "SELECT c.id,c.document_id,c.ticker,c.page,c.text,d.period FROM document_chunks c JOIN documents d ON d.id=c.document_id WHERE c.document_id=? AND c.ticker=? ORDER BY c.page,CAST(substr(c.id,length(c.document_id)+length(CAST(c.page AS TEXT))+3) AS INTEGER)",
    documentId,
    ticker,
  );
  const pageMap = new Map<number, string>();
  for (const c of chunks) {
    const prior = pageMap.get(c.page);
    pageMap.set(
      c.page,
      prior === undefined
        ? c.text
        : prior +
            (prior.endsWith(c.text.slice(0, 200)) ? c.text.slice(200) : c.text),
    );
  }
  const savedCalendar = await one<{ value: string }>(
    "SELECT value FROM meta WHERE key=?",
    `fiscal-calendar:${ticker}`,
  );
  const cal = savedCalendar ? JSON.parse(savedCalendar.value) : null;
  const yearEndMonth =
    cal?.yearEndMonth ??
    cal?.month ??
    financialSources.find((c) => c.ticker === ticker)?.yearEndMonth;
  const contexts = financialContexts(
    [...pageMap].map(([page, text]) => ({ page, text })),
    ticker,
  );
  const prose = extractReportedProse(
    [...pageMap].map(([page, text]) => ({ page, text })),
    yearEndMonth,
  );
  const table = extractExplicitTables(
    [...pageMap].map(([page, text]) => ({ page, text })),
    yearEndMonth,
  );
  prose.metrics.push(...table.metrics);
  const layouts = await all<{ payload: string }>(
    "SELECT payload FROM document_layouts WHERE document_id=? ORDER BY page",
    documentId,
  );
  const company = await one<{ name: string }>(
    "SELECT name FROM companies WHERE ticker=?",
    ticker,
  );
  const original = await one<{ hash: string }>(
    "SELECT hash FROM documents WHERE id=? AND ticker=?",
    documentId,
    ticker,
  );
  const registered = financialSources.find((c) => c.ticker === ticker);
  const verified = registered && {
    ...registered,
    currency:
      registered.currencyDocumentHash === original?.hash
        ? registered.currency
        : undefined,
  };
  const layout = extractPdfFinancials(
    layouts.map((l) => JSON.parse(l.payload) as PdfLayout),
    { ticker, name: company?.name ?? ticker },
    {
      ...verified,
      yearEndMonth: cal?.yearEndMonth ?? cal?.month ?? verified?.yearEndMonth,
      sectionContexts: Object.fromEntries(contexts),
    },
  );
  prose.metrics.push(...layout.metrics);
  if (layout.calendar)
    await run(
      "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
      `fiscal-calendar:${ticker}`,
      JSON.stringify({
        ...layout.calendar,
        yearEndMonth: layout.calendar.month,
        document_id: documentId,
      }),
    );
  const bestPeriod = sortPeriods([
    ...layout.periods,
    ...layout.metrics.map((m) => m.period),
  ])[0];
  if (bestPeriod)
    await run(
      "UPDATE documents SET period=?,period_status='source_table_header' WHERE id=?",
      bestPeriod,
      documentId,
    );
  for (const review of layout.reviews)
    await run(
      "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      documentId,
      PDF_LAYOUT_VERSION,
      "review",
      `Page ${review.page}: ${review.reason}`,
      new Date().toISOString(),
    );
  for (const r of table.rejected)
    await run(
      "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      documentId,
      "explicit_table_v1",
      "rejected",
      `Page ${r.page}: ${r.reason}`,
      new Date().toISOString(),
    );
  const deterministicStatements = [
    db()
      .prepare(
        "UPDATE financial_metrics SET verification_status='unverified' WHERE document_id=? AND extraction_method IN ('explicit_prose_v1','explicit_table_v1','explicit_table_v2','pdf_layout_v1','pdf_layout_v2','pdf_layout_v3','pdf_layout_v4','pdf_layout_v5','pdf_layout_v6','pdf_layout_v7')",
      )
      .bind(documentId),
  ];
  let deterministicAccepted = 0;
  for (const m of prose.metrics) {
    const record = await prepareFinancialMetric(
      ticker,
      documentId,
      m,
      m.extraction_method ?? "explicit_prose_v1",
    );
    if (record) {
      deterministicStatements.push(record.statement);
      deterministicAccepted++;
    }
  }
  // Withdraw stale parser output and replace it in one atomic batch; failed writes preserve old facts.
  await db().batch(deterministicStatements);
  for (const g of prose.guidance) {
    const id = await sha(
        `${ticker}:${g.metric}:${g.period}:${g.basis}:${documentId}:${g.page}`,
      ),
      d = await one<{ published_at: string | null }>(
        "SELECT published_at FROM documents WHERE id=?",
        documentId,
      );
    const previous = d?.published_at
      ? await one<{ id: string }>(
          "SELECT id FROM guidance_statements WHERE ticker=? AND metric=? AND target_period=? AND basis=? AND unit=? AND stated_at<? ORDER BY stated_at DESC LIMIT 1",
          ticker,
          g.metric,
          g.period,
          g.basis,
          g.unit,
          d.published_at,
        )
      : null;
    await run(
      "INSERT OR IGNORE INTO guidance_statements(id,ticker,metric,statement_text,guidance_type,target_min,target_max,unit,basis,stated_at,target_period,document_id,page,relevant_quote,qualifiers,extraction_confidence,revision_of) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      ticker,
      g.metric,
      g.quote,
      "range",
      g.low,
      g.high,
      g.unit,
      g.basis,
      d?.published_at ?? null,
      g.period,
      documentId,
      g.page,
      g.quote,
      "Explicitly parsed range; inspect later revisions before interpreting delivery.",
      0.9,
      previous?.id ?? null,
    );
  }
  if (options.preferDeterministic && layout.metrics.length) {
    await finishMetricExtraction(documentId);
    return {
      metrics: deterministicAccepted,
      guidance: prose.guidance.length,
      status: "verified_pdf_table",
      ai_status: "not_required",
    };
  }
  if (options.deterministicOnly || !providerStatus().enabled)
    return {
      metrics: deterministicAccepted,
      guidance: prose.guidance.length,
      status: "offline_explicit_prose",
    };
  // Bounded financial/guidance passages, not an unbounded annual report request.
  const documentMeta = await one<{ type: string }>(
    "SELECT type FROM documents WHERE id=?",
    documentId,
  );
  const sources = extractionPassages(
    chunks,
    documentMeta?.type ?? "results",
  ).map((s) => ({
    ...s,
    text: s.text.slice(0, 2400),
    period: explicitFinancialPeriod(s.text) ?? s.period,
    context_text: contexts.get(s.page)?.quote,
  }));
  if (!sources.length)
    return { metrics: 0, guidance: 0, status: "no_relevant_text" };
  let result;
  try {
    result = await aiTask("extraction", ticker, sources, (model) =>
      extractFinancialMetrics(
        geminiTransport(config()),
        model,
        ticker,
        sources,
      ),
    );
  } catch (e) {
    await run(
      "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      documentId,
      "gemini",
      "rejected",
      e instanceof AiFailure ? e.code : "validation_failed",
      new Date().toISOString(),
    );
    return {
      metrics: deterministicAccepted,
      guidance: prose.guidance.length,
      status: "gemini_extraction_failed",
      error_code: e instanceof AiFailure ? e.code : "validation_failed",
    };
  }
  const now = new Date().toISOString();
  if (result.rejected)
    await run(
      "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      documentId,
      "gemini",
      "rejected",
      `${result.rejected} candidate rows failed source/period validation.`,
      now,
    );
  let modelAccepted = 0;
  for (const m of result.metrics) {
    const deterministic = layout.metrics.filter(
      (d) =>
        d.name === m.name &&
        d.period === m.period &&
        /consolidated/i.test(d.basis) === /consolidated/i.test(m.basis),
    );
    if (deterministic.length) {
      if (!deterministic.some((d) => d.value === m.value))
        await run(
          "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
          crypto.randomUUID(),
          documentId,
          "gemini",
          "rejected",
          `${m.name} ${m.period}: model value conflicts with the verified PDF table column.`,
          now,
        );
      continue;
    }
    const source = sources.find((s) => s.id === m.source_id)!;
    const record = await prepareFinancialMetric(
      ticker,
      documentId,
      {
        ...m,
        page: source.page,
        evidence_text: m.evidence_excerpt,
        evidence_location: `PDF page ${source.page}; verified literal excerpt`,
        extraction_context: JSON.stringify({
          scope_source: contexts.get(source.page) ?? null,
          source_id: source.id,
        }),
      },
      "gemini",
      true,
    );
    if (record) {
      await db().batch([record.statement]);
      modelAccepted++;
    }
  }
  for (const g of result.guidance) {
    const source = sources.find((s) => s.id === g.source_id)!;
    const id = await sha(
      `${ticker}:${g.metric}:${g.target_period}:${g.basis}:${documentId}:${source.page}`,
    );
    const previous = await one<{ id: string }>(
      `SELECT id FROM guidance_statements WHERE ticker=? AND metric=? AND target_period=? AND basis=? AND unit=? AND stated_at<? ORDER BY stated_at DESC LIMIT 1`,
      ticker,
      g.metric,
      g.target_period,
      g.basis,
      g.unit,
      g.stated_at ?? now,
    );
    await run(
      `INSERT OR IGNORE INTO guidance_statements(id,ticker,metric,statement_text,guidance_type,target_min,target_max,unit,basis,stated_at,target_period,document_id,page,relevant_quote,qualifiers,extraction_confidence,revision_of) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      ticker,
      g.metric,
      g.evidence_excerpt,
      g.guidance_type,
      g.target_min,
      g.target_max,
      g.unit,
      g.basis,
      g.stated_at,
      g.target_period,
      documentId,
      source.page,
      g.evidence_excerpt,
      g.qualifiers,
      0.7,
      previous?.id ?? null,
    );
  }
  return {
    metrics: modelAccepted + deterministicAccepted,
    guidance: result.guidance.length,
    status: "source_checked",
    rejected: result.rejected,
  };
}
export async function classifyWithAi(ticker: string, sources: Source[]) {
  return aiTask("classification", ticker, sources, (model) =>
    classifyAnnouncement(geminiTransport(config()), model, ticker, sources),
  );
}
