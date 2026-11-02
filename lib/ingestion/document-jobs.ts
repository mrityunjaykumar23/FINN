import { extractionOutcome } from "../pipeline-state";
import {
  all,
  one,
  run,
  sha,
  lock,
  unlock,
  ApiError,
} from "../../db/repository";
import { PDF_LAYOUT_VERSION } from "../pdf-financials";
import { ingestPdf, safeSourceUrl } from "../server";
import { extractDocument } from "../ai/service";
export async function enqueueDocument(
  ticker: string,
  c: { url: string; title: string; type: string; officialHost?: string },
) {
  if (!safeSourceUrl(c.url, c.officialHost))
    throw new ApiError(
      422,
      "source_not_allowed",
      "Queue requires a verified original source.",
    );
  const id = await sha(`${ticker}:${c.url}`),
    now = new Date().toISOString();
  await run(
    "INSERT INTO document_jobs(id,ticker,url,title,type,official_host,status,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',0,?,?) ON CONFLICT(ticker,url) DO NOTHING",
    id,
    ticker,
    c.url,
    c.title,
    c.type,
    c.officialHost ?? null,
    now,
    now,
  );
  return id;
}
// A new parser may recover an indexed source without resetting provider retry budgets.
// Preserve the original attempt and error in the audit before changing its state.
export async function upgradeDocumentLayout(ticker: string, jobId: string) {
  const j = await one<{
    id: string;
    document_id: string | null;
    url: string;
    title: string;
    official_host: string | null;
    status: string;
    attempts: number;
    error: string | null;
  }>("SELECT * FROM document_jobs WHERE id=? AND ticker=?", jobId, ticker);
  if (!j?.document_id || ["running", "extracting"].includes(j.status)) return;
  const version = await one<{ value: string }>(
    "SELECT value FROM meta WHERE key=?",
    `layout-checked:${j.document_id}`,
  );
  if (
    version?.value === PDF_LAYOUT_VERSION ||
    !(await lock(`layout-upgrade:${j.document_id}`, 90000))
  )
    return;
  try {
    const id = await ingestPdf(
      ticker,
      j.url,
      j.title,
      j.official_host ?? undefined,
      { background: true },
    );
    const result = await extractDocument(ticker, id, {
      preferDeterministic: true,
      deterministicOnly: true,
    });
    await run(
      "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      id,
      PDF_LAYOUT_VERSION,
      "parser_upgrade",
      JSON.stringify({
        prior_status: j.status,
        prior_error: j.error,
        provider_attempts: j.attempts,
        prior_version: version?.value ?? null,
        result,
      }),
      new Date().toISOString(),
    );
    const accepted = Number(result.metrics) > 0 || Number(result.guidance) > 0;
    if (accepted)
      await run(
        "UPDATE document_jobs SET status='complete',extraction_status=?,extraction_result=?,error=NULL,next_retry=NULL,updated_at=? WHERE id=? AND status=?",
        result.status,
        JSON.stringify(result),
        new Date().toISOString(),
        j.id,
        j.status,
      );
    else if (
      !(await one(
        "SELECT id FROM financial_metrics WHERE document_id=? AND verification_status<>'unverified' LIMIT 1",
        id,
      ))
    )
      await run(
        "UPDATE document_jobs SET status=?,error=?,next_retry=NULL,updated_at=? WHERE id=? AND status=?",
        j.attempts < 3 ? "extraction_pending" : "manual_required",
        "New layout did not establish accepted financial facts; prior provider attempt count retained.",
        new Date().toISOString(),
        j.id,
        j.status,
      );
  } finally {
    await unlock(`layout-upgrade:${j.document_id}`);
  }
}
export async function processDocumentJobs(
  limit = 1,
  ticker?: string,
  id?: string,
  options: { indexOnly?: boolean; preferDeterministic?: boolean } = {},
) {
  const now = new Date().toISOString(),
    expired = new Date(Date.now() - 2 * 60000).toISOString();
  const jobs = await all<{
    id: string;
    ticker: string;
    url: string;
    title: string;
    type: string;
    official_host: string | null;
    attempts: number;
    document_id: string | null;
  }>(
    `SELECT * FROM document_jobs WHERE attempts<3 AND ((status IN ('pending','failed','extraction_failed','extraction_pending') AND (next_retry IS NULL OR next_retry<=?)) OR (status IN ('running','extracting') AND updated_at<?)) ${ticker ? "AND ticker=?" : ""} ${id ? "AND id=?" : ""} ORDER BY created_at,id LIMIT ?`,
    now,
    expired,
    ...(ticker ? [ticker] : []),
    ...(id ? [id] : []),
    Math.max(1, Math.min(2, limit)),
  );
  const results = [];
  for (const j of jobs) {
    const claimed = await one<{ id: string }>(
      "UPDATE document_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND attempts=? AND (status IN ('pending','failed','extraction_failed','extraction_pending') OR (status IN ('running','extracting') AND updated_at<?)) RETURNING id",
      now,
      j.id,
      j.attempts,
      expired,
    );
    if (!claimed) continue;
    try {
      const known = j.document_id
        ? await one<{ id: string }>(
            "SELECT id FROM documents WHERE id=? AND ticker=?",
            j.document_id,
            j.ticker,
          )
        : null;
      const id =
        known?.id ??
        (await ingestPdf(
          j.ticker,
          j.url,
          j.title,
          j.official_host ?? undefined,
          { background: true },
        ));
      await run(
        "UPDATE documents SET type=? WHERE id=? AND ticker=?",
        j.type,
        id,
        j.ticker,
      );
      await run(
        "UPDATE document_jobs SET status='extracting',document_id=?,updated_at=? WHERE id=?",
        id,
        new Date().toISOString(),
        j.id,
      );
      await run(
        "UPDATE discovery_candidates SET status='indexed',document_id=?,detail=NULL WHERE ticker=? AND url=?",
        id,
        j.ticker,
        j.url,
      );
      if (options.indexOnly) {
        await run(
          "UPDATE document_jobs SET status='extraction_pending',extraction_status='pending',attempts=max(0,attempts-1),next_retry=NULL,updated_at=? WHERE id=?",
          new Date().toISOString(),
          j.id,
        );
        results.push({
          id: j.id,
          status: "extraction_pending",
          document_id: id,
          error: null,
        });
        continue;
      }
      const extraction = await extractDocument(j.ticker, id, {
        preferDeterministic: options.preferDeterministic,
      }).catch(() => ({
        status: "extraction_failed",
        error_code: "extraction_exception",
      }));
      const outcome = extractionOutcome(extraction, j.type, j.attempts + 1);
      await run(
        "UPDATE document_jobs SET status=?,extraction_status=?,extraction_result=?,error=?,next_retry=?,updated_at=? WHERE id=?",
        outcome.status,
        extraction.status,
        JSON.stringify(extraction),
        outcome.error,
        outcome.status === "extraction_failed"
          ? new Date(Date.now() + 5 * 60000 * 2 ** j.attempts).toISOString()
          : null,
        new Date().toISOString(),
        j.id,
      );
      results.push({
        id: j.id,
        status: outcome.status,
        document_id: id,
        extraction,
        error: outcome.error,
      });
    } catch (e) {
      const error =
        e instanceof Error
          ? e.message.slice(0, 600)
          : "Original document processing failed";
      const status =
        j.attempts >= 2 ||
        /exceeds|source_not_allowed|matching company|Scanned|valid PDF/i.test(
          error,
        )
          ? "manual_required"
          : "failed";
      await run(
        "UPDATE document_jobs SET status=?,error=?,next_retry=?,updated_at=? WHERE id=?",
        status,
        error,
        status === "failed"
          ? new Date(Date.now() + 5 * 60000 * 2 ** j.attempts).toISOString()
          : null,
        new Date().toISOString(),
        j.id,
      );
      results.push({ id: j.id, status, error });
    }
  }
  return {
    results,
    counts: await all<{ status: string; n: number }>(
      "SELECT status,count(*) n FROM document_jobs GROUP BY status",
    ),
  };
}
