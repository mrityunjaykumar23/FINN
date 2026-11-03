import { parseDocument, DomUtils } from "htmlparser2";
import { one, db, run, ApiError } from "../../db/repository";
import {
  parseStructuredFinancials,
  STRUCTURED_VERSION,
} from "../structured-financials";
import { sortPeriods } from "../periods";
/** Called only after the shared, allowlisted HTTP downloader has verified redirects and size. */
export async function ingestStructuredSource(
  ticker: string,
  url: string,
  title: string,
  bytes: Uint8Array,
  chunk: (text: string) => string[],
) {
  if (bytes.length > 1_000_000)
    throw new ApiError(
      422,
      "unsupported_file_format",
      "Structured financial documents are limited to 1 MB.",
    );
  const company = await one<{ name: string }>(
    "SELECT name FROM companies WHERE ticker=?",
    ticker,
  );
  if (!company)
    throw new ApiError(
      422,
      "document_company_unverified",
      "Resolve the company before importing its evidence.",
    );
  const raw = new TextDecoder().decode(bytes);
  let parsed: ReturnType<typeof parseStructuredFinancials>;
  try {
    parsed = parseStructuredFinancials(raw, { ticker, name: company.name });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Unsupported financial source";
    if (!/^(?:reporting_period_unresolved|unit_ambiguous):/.test(message))
      throw e;
    // Identity validation precedes these errors. Keep usable text even if financial context failed.
    const dom = parseDocument(raw),
      tables = DomUtils.findAll((n) => n.name === "table", dom.children);
    parsed = {
      format: "structured_html",
      facts: [],
      sections: tables.map((t, i) => ({
        page: i + 1,
        text: DomUtils.textContent(t).replace(/\s+/g, " ").trim(),
      })),
      reviews: [{ section: 1, reason: message }],
      calendar: { yearEndMonth: 0, source: "Unresolved" },
      metadata: {},
    };
  }
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const existing = await one<{ id: string; ticker: string }>(
    "SELECT id,ticker FROM documents WHERE hash=?",
    hash,
  );
  if (existing && existing.ticker !== ticker)
    throw new ApiError(
      422,
      "document_company_conflict",
      "This source belongs to a different company.",
    );
  const id = existing?.id ?? `live-${hash.slice(0, 20)}`,
    period =
      sortPeriods(parsed.facts.map((f) => f.period)).find((p) =>
        p.startsWith("Q"),
      ) ?? "Period not verified",
    now = new Date().toISOString(),
    payload = JSON.stringify(parsed);
  if (new TextEncoder().encode(payload).length > 512_000)
    throw new ApiError(
      422,
      "unsupported_file_format",
      "Structured context exceeds the bounded extraction limit.",
    );
  const statements = [
    db()
      .prepare(
        "INSERT INTO documents(id,ticker,title,type,period,url,retrieved_at,hash,mode,publisher,extraction_status,total_pages,indexed_pages,period_status,source_format) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_format=excluded.source_format,period=excluded.period,period_status=excluded.period_status",
      )
      .bind(
        id,
        ticker,
        title,
        "results",
        period,
        url,
        now,
        hash,
        "live",
        new URL(url).hostname,
        "complete",
        parsed.sections.length,
        parsed.sections.length,
        period === "Period not verified" ? "unverified" : "structured_context",
        parsed.format,
      ),
  ];
  if (!existing)
    for (const section of parsed.sections)
      for (const [i, text] of chunk(section.text).entries())
        statements.push(
          db()
            .prepare(
              "INSERT INTO document_chunks(id,document_id,ticker,page,text) VALUES (?,?,?,?,?)",
            )
            .bind(`${id}:${section.page}:${i}`, id, ticker, section.page, text),
        );
  statements.push(
    db()
      .prepare(
        "INSERT INTO source_payloads(document_id,format,raw,payload,version) VALUES (?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET payload=excluded.payload,version=excluded.version",
      )
      .bind(id, parsed.format, raw, payload, STRUCTURED_VERSION),
  );
  await db().batch(statements);
  if (parsed.calendar.yearEndMonth)
    await run(
      "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
      `fiscal-calendar:${ticker}`,
      JSON.stringify({ ...parsed.calendar, source: url, document_id: id }),
    );
  return id;
}
