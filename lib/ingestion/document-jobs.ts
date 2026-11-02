import { extractionOutcome } from "../pipeline-state";
import { all, one, run, sha, ApiError } from "../../db/repository";
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
export async function processDocumentJobs(
  limit = 1,
  ticker?: string,
  id?: string,
) {
  const now = new Date().toISOString(),
    expired = new Date(Date.now() - 15 * 60000).toISOString();
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
    `SELECT * FROM document_jobs WHERE attempts<3 AND ((status IN ('pending','failed','extraction_failed') AND (next_retry IS NULL OR next_retry<=?)) OR (status IN ('running','extracting') AND updated_at<?)) ${ticker ? "AND ticker=?" : ""} ${id ? "AND id=?" : ""} ORDER BY created_at,id LIMIT ?`,
    now,
    expired,
    ...(ticker ? [ticker] : []),
    ...(id ? [id] : []),
    Math.max(1, Math.min(2, limit)),
  );
  const results = [];
  for (const j of jobs) {
    const claimed = await one<{ id: string }>(
      "UPDATE document_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND attempts=? AND (status IN ('pending','failed','extraction_failed') OR (status IN ('running','extracting') AND updated_at<?)) RETURNING id",
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
      const extraction = await extractDocument(j.ticker, id).catch(() => ({
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
