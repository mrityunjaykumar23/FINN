import { env } from "cloudflare:workers";
import {
  all,
  one,
  run,
  budget,
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
    .map((m) => ({ ...m, evidence_text: undefined }));
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
export async function extractDocument(ticker: string, documentId: string) {
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
  const prose = extractReportedProse(
    [...pageMap].map(([page, text]) => ({ page, text })),
  );
  const table = extractExplicitTables(
    [...pageMap].map(([page, text]) => ({ page, text })),
  );
  prose.metrics.push(...table.metrics);
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
  const nowProse = new Date().toISOString();
  await run(
    "UPDATE financial_metrics SET verification_status='unverified' WHERE document_id=? AND extraction_method IN ('explicit_prose_v1','explicit_table_v1','explicit_table_v2')",
    documentId,
  );
  for (const m of prose.metrics) {
    const id = await sha(
      `${ticker}:${m.name}:${m.period}:${m.basis}:${documentId}`,
    );
    await run(
      `INSERT INTO financial_metrics(id,ticker,name,value,period,unit,basis,document_id,page,evidence_text,extraction_method,verification_status,updated_at,currency,scale,fiscal_year,fiscal_quarter) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,evidence_text=excluded.evidence_text,page=excluded.page,updated_at=excluded.updated_at,verification_status=excluded.verification_status WHERE financial_metrics.extraction_method IN ('explicit_prose_v1','explicit_table_v1','explicit_table_v2')`,
      id,
      ticker,
      m.name,
      m.value,
      m.period,
      m.unit,
      m.basis,
      documentId,
      m.page,
      m.evidence_text,
      m.extraction_method ?? "explicit_prose_v1",
      "source_checked",
      nowProse,
      m.unit === "%" ? null : "INR",
      m.unit === "%" ? null : m.unit.replace(/^INR /, ""),
      Number(m.period.match(/FY(\d{4})/)![1]),
      Number(m.period.match(/^Q([1-4])/)?.[1]) || null,
    );
    if (m.reporting_status)
      await run(
        "UPDATE financial_metrics SET reporting_status=? WHERE id=?",
        m.reporting_status,
        id,
      );
  }
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
  if (!providerStatus().enabled)
    return {
      metrics: prose.metrics.length,
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
  ).map((s) => ({ ...s, text: s.text.slice(0, 2400) }));
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
      metrics: prose.metrics.length,
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
  for (const m of result.metrics) {
    const source = sources.find((s) => s.id === m.source_id)!;
    const id = await sha(
      `${ticker}:${m.name}:${m.period}:${m.basis}:${m.unit}:${documentId}`,
    );
    await run(
      `INSERT OR IGNORE INTO financial_metrics(id,ticker,name,value,period,unit,basis,document_id,page,currency,scale,fiscal_year,fiscal_quarter,evidence_text,extraction_method,verification_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      ticker,
      m.name,
      m.value,
      m.period,
      m.unit,
      m.basis,
      documentId,
      source.page,
      /INR|₹/.test(m.unit) ? "INR" : /USD|\$/.test(m.unit) ? "USD" : null,
      /crore/i.test(m.unit)
        ? "crore"
        : /million/i.test(m.unit)
          ? "million"
          : null,
      Number(m.period.match(/FY(\d{4})/)![1]),
      Number(m.period.match(/^Q([1-4])/)?.[1]) || null,
      m.evidence_excerpt,
      "gemini",
      "source_checked",
      now,
    );
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
    metrics: result.metrics.length,
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
