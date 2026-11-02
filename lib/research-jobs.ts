import { all, one, run, sha, ApiError } from "../db/repository";
import { discoverDocuments, research } from "./server";
import { processDocumentJobs } from "./ingestion/document-jobs";
import type { Research } from "./types";
import { providerStatus } from "./ai/service";
import { canonicalResearchFilters } from "./research-filters";
type Job = {
  id: string;
  owner_id: string;
  ticker: string;
  question: string;
  filters: string;
  status: string;
  phase: string;
  attempts: number;
  document_job_id: string | null;
  detail: string | null;
  result: string | null;
  error: string | null;
  updated_at: string;
};
export async function researchJob(owner: string, id: string) {
  const job = await one<Job>(
    "SELECT * FROM research_jobs WHERE id=? AND owner_id=?",
    id,
    owner,
  );
  if (!job)
    throw new ApiError(
      404,
      "research_job_not_found",
      "Research request is unavailable in this visitor workspace.",
    );
  const doc = job.document_job_id
    ? await one<{
        status: string;
        extraction_status: string | null;
        error: string | null;
      }>(
        "SELECT status,extraction_status,error FROM document_jobs WHERE id=?",
        job.document_job_id,
      )
    : null;
  return {
    id: job.id,
    ticker: job.ticker,
    status: job.status,
    phase:
      job.phase === "documents" && doc?.status === "extracting"
        ? "extraction"
        : job.phase,
    detail: job.detail,
    error: job.error,
    document: doc,
    updated_at: job.updated_at,
    result:
      job.status === "complete" && job.result
        ? (JSON.parse(job.result) as Research)
        : null,
  };
}
export async function createResearchJob(
  owner: string,
  ticker: string,
  question: string,
  filters: { type?: string; period?: string },
) {
  filters = canonicalResearchFilters(filters);
  const version = await one<{ revision: number }>(
    "SELECT revision FROM company_versions WHERE ticker=?",
    ticker,
  );
  const provider = providerStatus();
  const id = await sha(
    JSON.stringify([
      owner,
      ticker,
      question.trim().toLowerCase(),
      filters,
      version?.revision ?? 0,
      provider.enabled,
      provider.model,
      provider.reasoning_model,
      provider.prompt_version,
    ]),
  );
  const now = new Date().toISOString();
  await run(
    "INSERT INTO research_jobs(id,owner_id,ticker,question,filters,status,phase,attempts,created_at,updated_at) VALUES (?,?,?,?,?,'queued','discovery',0,?,?) ON CONFLICT(id) DO NOTHING",
    id,
    owner,
    ticker,
    question,
    JSON.stringify(filters),
    now,
    now,
  );
  // A completed request is not a permanent cache. Existing financial/version cache rules remain authoritative.
  await run(
    "UPDATE research_jobs SET status='queued',phase='discovery',attempts=0,result=NULL,error=NULL,detail=NULL,document_job_id=NULL,updated_at=? WHERE id=? AND owner_id=? AND status='complete' AND (updated_at<? OR (coalesce(json_extract(result,'$.ai_status'),'') NOT IN ('success','offline') AND updated_at<?))",
    now,
    id,
    owner,
    new Date(Date.now() - 15 * 60000).toISOString(),
    new Date(Date.now() - 60000).toISOString(),
  );
  // Explicit resubmission resumes the saved phase after its source retry window.
  await run(
    "UPDATE research_jobs SET status='queued',error=NULL,updated_at=? WHERE id=? AND owner_id=? AND status='failed' AND attempts<3 AND updated_at<? AND (document_job_id IS NULL OR NOT EXISTS (SELECT 1 FROM document_jobs d WHERE d.id=research_jobs.document_job_id AND d.next_retry>?))",
    now,
    id,
    owner,
    new Date(Date.now() - 60000).toISOString(),
    now,
  );
  return researchJob(owner, id);
}
export async function claimResearchJob(owner: string, id: string) {
  await researchJob(owner, id);
  const now = new Date().toISOString(),
    expired = new Date(Date.now() - 90000).toISOString();
  await run(
    "UPDATE research_jobs SET status='failed',error='Research worker lease expired repeatedly; retry or inspect source availability.',updated_at=? WHERE id=? AND owner_id=? AND status='running' AND attempts>=3 AND updated_at<?",
    now,
    id,
    owner,
    expired,
  );
  return one<Job>(
    "UPDATE research_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND owner_id=? AND attempts<3 AND (status='queued' OR (status='running' AND updated_at<?)) RETURNING *",
    now,
    id,
    owner,
    expired,
  );
}
export async function runResearchPhase(job: Job) {
  // Every advance is bounded and durable; stale phases can be reclaimed after process interruption.
  try {
    const filters = JSON.parse(job.filters) as {
      type?: string;
      period?: string;
    };
    const next = async (
      phase: string,
      detail: string,
      documentId: string | null = job.document_job_id,
    ) =>
      run(
        "UPDATE research_jobs SET phase=?,status='queued',attempts=0,detail=?,document_job_id=?,updated_at=? WHERE id=? AND status='running'",
        phase,
        detail,
        documentId,
        new Date().toISOString(),
        job.id,
      );
    if (job.phase === "discovery") {
      const docs = await all<{ id: string }>(
        `SELECT id FROM documents WHERE ticker=? ${filters.type ? "AND type=?" : ""} ${filters.period ? "AND period=?" : ""} LIMIT 1`,
        job.ticker,
        ...(filters.type ? [filters.type] : []),
        ...(filters.period ? [filters.period] : []),
      );
      if (docs.length) {
        const existing = await one<{ id: string; status: string }>(
          "SELECT id,status FROM document_jobs WHERE ticker=? AND document_id=? ORDER BY created_at LIMIT 1",
          job.ticker,
          docs[0].id,
        );
        await next(
          existing && !["complete", "manual_required"].includes(existing.status)
            ? "extraction"
            : "analysis",
          existing?.status === "manual_required"
            ? "Indexed text is available; financial extraction needs review."
            : "Using already indexed primary sources and stored financial facts.",
          existing?.id ?? null,
        );
        return;
      }
      const discovered = await discoverDocuments(job.ticker, {
        ...filters,
        question: job.question,
        queueOnly: true,
      });
      let id = "job_ids" in discovered ? discovered.job_ids?.[0] : undefined;
      if (!id) {
        // Discovery cooldowns must still resume previously queued work, rather than duplicate downloads.
        id = (
          await one<{ id: string }>(
            `SELECT id FROM document_jobs WHERE ticker=? AND status IN ('pending','failed','extraction_failed','extraction_pending','running','extracting') ${filters.type ? "AND type=?" : ""} ORDER BY created_at,id LIMIT 1`,
            job.ticker,
            ...(filters.type ? [filters.type] : []),
          )
        )?.id;
      }
      if (!id)
        throw new Error(
          discovered.limitations?.join(" ") ||
            "No permitted original document is ready. Source coverage requires review.",
        );
      await next(
        "documents",
        "Primary links discovered. A durable document job will index one original at a time.",
        id,
      );
    } else if (job.phase === "documents") {
      const processed = await processDocumentJobs(
        1,
        job.ticker,
        job.document_job_id ?? undefined,
        { indexOnly: true },
      );
      const doc = await one<{
        status: string;
        document_id: string | null;
        error: string | null;
      }>(
        "SELECT status,document_id,error FROM document_jobs WHERE id=?",
        job.document_job_id,
      );
      if (!doc?.document_id)
        throw new Error(
          doc?.error ||
            (processed.results.length
              ? "Original could not be indexed."
              : "Document job is waiting for its retry window. Retry this request after the source cooldown."),
        );
      await next(
        doc.status === "complete" ? "analysis" : "extraction",
        "Original text indexed. Preparing financial extraction without another download.",
      );
    } else if (job.phase === "extraction") {
      await processDocumentJobs(
        1,
        job.ticker,
        job.document_job_id ?? undefined,
      );
      const doc = await one<{ status: string; error: string | null }>(
        "SELECT status,error FROM document_jobs WHERE id=?",
        job.document_job_id,
      );
      if (doc && ["running", "extracting"].includes(doc.status)) {
        await next(
          "extraction",
          "The existing document extraction is still running.",
        );
        return;
      }
      await next(
        "analysis",
        doc?.status === "complete"
          ? "Financial extraction completed. Analysing matching source passages."
          : `Indexed text is available; financial extraction needs review: ${doc?.error ?? doc?.status ?? "unavailable"}`,
      );
    } else if (["analysis", "synthesis"].includes(job.phase)) {
      const result = await research(job.ticker, job.question, filters, {
        prepared: true,
        onSynthesis: async () => {
          await run(
            "UPDATE research_jobs SET phase='synthesis',detail='Preparing grounded research from primary evidence. Matching model output is reused when available.',updated_at=? WHERE id=?",
            new Date().toISOString(),
            job.id,
          );
        },
      });
      if (job.detail?.includes("needs review"))
        result.limitations.unshift(job.detail);
      await run(
        "UPDATE research_jobs SET status='complete',phase='complete',result=?,error=NULL,updated_at=? WHERE id=?",
        JSON.stringify(result),
        new Date().toISOString(),
        job.id,
      );
    } else
      throw new Error("Unsupported research phase; request requires review.");
  } catch (e) {
    await run(
      "UPDATE research_jobs SET status='failed',error=?,updated_at=? WHERE id=?",
      e instanceof Error
        ? e.message.slice(0, 900)
        : "Research preparation unavailable.",
      new Date().toISOString(),
      job.id,
    );
  }
}
