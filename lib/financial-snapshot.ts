import { financialAnalysis } from "./financial-analysis";
import {
  all,
  one,
  run,
  sha,
  lock,
  unlock,
  budget,
  ApiError,
} from "../db/repository";
import {
  DISCOVERY_VERSION,
  locatePrimaryCandidates,
  rankCandidates,
} from "./ingestion/discovery";
import {
  enqueueDocument,
  processDocumentJobs,
  upgradeDocumentLayout,
} from "./ingestion/document-jobs";
import { financialExtractorVersion } from "./financial-store";
import { safeSourceUrl } from "./server";
import { sortPeriods, latestFinancialPeriod } from "./periods";
import {
  snapshotMetricStates,
  type MetricProgress,
  type SnapshotSource,
} from "./snapshot-state";
import { financialSector } from "./financial-definitions";
import type { Metric } from "./domain";
type SnapshotJob = {
  id: string;
  owner_id: string;
  ticker: string;
  status: string;
  phase: string;
  attempts: number;
  filters: string;
  document_job_id: string | null;
  error: string | null;
  detail: string | null;
  updated_at: string;
};
const PIPELINE_VERSION = financialExtractorVersion + ":" + DISCOVERY_VERSION;
export async function snapshotState(
  owner: string,
  ticker: string,
  requested?: string,
  requestedBasis?: string,
) {
  const id = await sha(`financial-snapshot-v1:${owner}:${ticker}`);
  const job = await one<SnapshotJob>(
    "SELECT * FROM research_jobs WHERE id=? AND owner_id=? AND purpose='snapshot'",
    id,
    owner,
  );
  const metrics = await all<Metric>(
    "SELECT m.*,d.url AS source_url,d.source_format FROM financial_metrics m JOIN documents d ON d.id=m.document_id WHERE m.ticker=? AND m.verification_status<>'unverified'",
    ticker,
  );
  const documents = await all<{
    id: string;
    url: string;
    type: string;
    period: string;
    extraction_status: string;
    source_format: string;
  }>(
    "SELECT id,url,type,period,extraction_status,source_format FROM documents WHERE ticker=?",
    ticker,
  );
  const periods = sortPeriods(
    metrics.filter((m) => m.value !== null).map((m) => m.period),
  );
  const period = requested ?? latestFinancialPeriod(periods) ?? null;
  const selectedIds: string[] = job ? (JSON.parse(job.filters).ids ?? []) : [];
  const children = await all<SnapshotSource>(
    `SELECT id,status,document_id,error,error_code,failed_stage,url FROM document_jobs WHERE ticker=? ${selectedIds.length ? `AND id IN (${selectedIds.map(() => "?").join(",")})` : "AND 0=1"}`,
    ticker,
    ...selectedIds,
  );
  const relevantDocs = children.flatMap((c) =>
    c.document_id ? [c.document_id] : [],
  );
  const progress = relevantDocs.length
    ? await all<MetricProgress>(
        `SELECT * FROM metric_processing WHERE document_id IN (${relevantDocs.map(() => "?").join(",")})`,
        ...relevantDocs,
      )
    : [];
  const company = await one<{ name: string; sector: string }>(
    "SELECT name,sector FROM companies WHERE ticker=?",
    ticker,
  );
  const basis =
    requestedBasis ??
    (metrics.some((m) => /consolidated/i.test(m.basis))
      ? "Consolidated"
      : "Standalone");
  const derived = snapshotMetricStates({
    metrics,
    period,
    basis,
    job,
    sources: children,
    progress,
    financialSector: financialSector({ ticker, ...company }) === "financial",
  });
  const failures = children.filter(
    (c) =>
      c.error &&
      ["failed", "extraction_failed", "manual_required"].includes(c.status),
  );
  return {
    id,
    ticker,
    status: job?.status ?? "not_started",
    phase: job?.phase ?? "not_started",
    detail: job?.detail ?? null,
    error: job?.error ?? null,
    updated_at: job?.updated_at ?? null,
    period,
    periods,
    metrics,
    documents,
    basis,
    sector: financialSector({ ticker, ...company }),
    statuses: derived.statuses,
    analysis: period
      ? financialAnalysis(
          metrics.filter((m) => new RegExp(basis, "i").test(m.basis)),
          period,
          financialSector({ ticker, ...company }),
        )
      : [],
    readiness: derived.readiness,
    source_states: children.map((c) => ({
      ...c,
      download_status: c.document_id
        ? "complete"
        : c.status === "running"
          ? "downloading"
          : c.failed_stage === "download" || c.status === "failed"
            ? "failed"
            : "not_started",
      indexing_status: c.document_id ? "complete" : "not_started",
      financial_status:
        c.status === "complete"
          ? "complete"
          : c.status === "extracting"
            ? "extracting"
            : c.failed_stage === "extraction"
              ? "failed"
              : "not_started",
    })),
    financial_errors: failures.map((j) => j.error).filter(Boolean),
  };
}
export async function createSnapshot(
  owner: string,
  ticker: string,
  force = false,
) {
  const id = await sha(`financial-snapshot-v1:${owner}:${ticker}`),
    now = new Date().toISOString();
  await run(
    "INSERT INTO research_jobs(id,owner_id,ticker,question,purpose,filters,status,phase,created_at,updated_at) VALUES (?,?,?,'Prepare verified financial snapshot','snapshot',?,'queued','discovery',?,?) ON CONFLICT(id) DO NOTHING",
    id,
    owner,
    ticker,
    JSON.stringify({ version: PIPELINE_VERSION, force_discovery: force }),
    now,
    now,
  );
  await run(
    "UPDATE research_jobs SET status='queued',phase='discovery',attempts=0,error=NULL,detail=NULL,filters=?,updated_at=? WHERE id=? AND status IN ('complete','failed') AND (updated_at<? OR (?=1 AND updated_at<?) OR coalesce(json_extract(filters,'$.version'),'')<>?)",
    JSON.stringify({ version: PIPELINE_VERSION, force_discovery: force }),
    now,
    id,
    new Date(Date.now() - 86400000).toISOString(),
    force ? 1 : 0,
    new Date(Date.now() - 60000).toISOString(),
    PIPELINE_VERSION,
  );
  return snapshotState(owner, ticker);
}
export async function claimSnapshot(owner: string, ticker: string) {
  const id = await sha(`financial-snapshot-v1:${owner}:${ticker}`),
    now = new Date().toISOString(),
    expired = new Date(Date.now() - 90000).toISOString();
  const exists = await one(
    "SELECT id FROM research_jobs WHERE id=? AND owner_id=? AND purpose='snapshot'",
    id,
    owner,
  );
  if (!exists)
    throw new ApiError(
      404,
      "snapshot_not_found",
      "Start financial preparation in this visitor workspace first.",
    );
  await run(
    "UPDATE research_jobs SET status='failed',error='Financial preparation lease expired repeatedly. Retry or inspect the saved source state.',updated_at=? WHERE id=? AND attempts>=3 AND status='running' AND updated_at<?",
    now,
    id,
    expired,
  );
  return one<SnapshotJob>(
    "UPDATE research_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND attempts<3 AND (status='queued' OR (status='running' AND updated_at<?)) RETURNING *",
    now,
    id,
    expired,
  );
}
export async function runSnapshot(job: SnapshotJob) {
  const next = async (
    phase: string,
    detail: string,
    filters = job.filters,
    documentId = job.document_job_id,
  ) =>
    run(
      "UPDATE research_jobs SET status='queued',phase=?,detail=?,filters=?,document_job_id=?,attempts=0,updated_at=? WHERE id=?",
      phase,
      detail,
      filters,
      documentId,
      new Date().toISOString(),
      job.id,
    );
  try {
    if (job.phase === "discovery") {
      const cached = await one<{ value: string }>(
        "SELECT value FROM meta WHERE key=?",
        `snapshot-candidates:${job.ticker}`,
      );
      let saved = cached
        ? (JSON.parse(cached.value) as {
            at: string;
            ids: string[];
            version?: string;
          })
        : null;
      const forceDiscovery = JSON.parse(job.filters).force_discovery === true;
      if (
        !saved ||
        saved.version !== DISCOVERY_VERSION ||
        Date.parse(saved.at) < Date.now() - 86400000 ||
        (forceDiscovery && Date.parse(saved.at) < Date.now() - 5 * 60000)
      ) {
        if (!(await lock(`snapshot-discovery:${job.ticker}`, 90000))) {
          await next(
            "discovery",
            "Another visitor is checking the same primary source. Reusing its work.",
          );
          return;
        }
        try {
          await budget(`snapshot-discovery:${job.ticker}`, 12);
          const result = await locatePrimaryCandidates(
            job.ticker,
            safeSourceUrl,
          );
          await run(
            "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
            `source-catalogue:${job.ticker}`,
            JSON.stringify({
              at: new Date().toISOString(),
              version: DISCOVERY_VERSION,
              result,
            }),
          );
          const existing = await all<{
            url: string;
            title: string;
            type: string;
            period: string;
            source_format: string;
          }>(
            "SELECT url,title,type,period,source_format FROM documents WHERE ticker=? AND type IN ('results','annual_report','presentation') ORDER BY retrieved_at DESC",
            job.ticker,
          );
          const ranked = rankCandidates(
            [
              ...existing
                .filter((d) => d.source_format !== "pdf")
                .map((d, i) => ({
                  ...d,
                  published_at: null,
                  order: i - 20,
                  officialHost: new URL(d.url).hostname.replace(/^www\./, ""),
                })),
              ...result.candidates,
            ],
            "latest financial results",
          );
          const chosen = [
            ...ranked.filter((c) => c.type === "results").slice(0, 3),
            ...ranked.filter((c) => c.type === "presentation").slice(0, 1),
            ...ranked.filter((c) => c.type === "annual_report").slice(0, 1),
          ].filter((c, i, a) => a.findIndex((x) => x.url === c.url) === i);
          if (!chosen.length)
            throw Error(
              "No permitted original financial results or presentation was found. Financial coverage is incomplete; verified older values remain available.",
            );
          const ids = [];
          for (const c of chosen)
            ids.push(await enqueueDocument(job.ticker, c));
          saved = {
            at: new Date().toISOString(),
            ids,
            version: DISCOVERY_VERSION,
          };
          await run(
            "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
            `snapshot-candidates:${job.ticker}`,
            JSON.stringify(saved),
          );
        } finally {
          await unlock(`snapshot-discovery:${job.ticker}`);
        }
      }
      await next(
        "indexing",
        "Indexing the original financial results. Prior verified metrics remain visible.",
        JSON.stringify({
          ids: saved.ids,
          index: 0,
          version: PIPELINE_VERSION,
          force_retry: forceDiscovery,
        }),
        saved.ids[0],
      );
    } else if (job.phase === "indexing") {
      if (JSON.parse(job.filters).force_retry)
        await run(
          "UPDATE document_jobs SET status='extraction_pending',next_retry=NULL WHERE id=? AND document_id IS NOT NULL AND status='manual_required' AND attempts<3 AND updated_at<?",
          job.document_job_id,
          new Date(Date.now() - 60000).toISOString(),
        );
      await processDocumentJobs(
        1,
        job.ticker,
        job.document_job_id ?? undefined,
        { indexOnly: true },
      );
      await upgradeDocumentLayout(job.ticker, job.document_job_id ?? "");
      const doc = await one<{
        status: string;
        document_id: string | null;
        error: string | null;
      }>(
        "SELECT status,document_id,error FROM document_jobs WHERE id=?",
        job.document_job_id,
      );
      if (doc && ["running", "extracting"].includes(doc.status)) {
        await next(
          "indexing",
          "The shared original document is still processing.",
        );
        return;
      }
      if (!doc?.document_id) {
        await next(
          "next_source",
          doc?.error ??
            "Original financial document is waiting for its retry window or unavailable. Checking independent sources.",
        );
        return;
      }
      await next(
        doc.status === "complete" ? "next_source" : "extracting",
        "Original pages indexed. Validating accounting scope, reporting columns and financial figures.",
      );
    } else if (job.phase === "extracting") {
      await processDocumentJobs(
        1,
        job.ticker,
        job.document_job_id ?? undefined,
        { preferDeterministic: true },
      );
      const child = await one<{ status: string; error: string | null }>(
        "SELECT status,error FROM document_jobs WHERE id=?",
        job.document_job_id,
      );
      if (child && ["running", "extracting"].includes(child.status)) {
        await next(
          "extracting",
          "Financial extraction is still running in the shared document job.",
        );
        return;
      }
      await next(
        "next_source",
        child?.status === "complete"
          ? "Source-backed financial figures accepted."
          : `Financial extraction needs attention: ${child?.error ?? child?.status ?? "unavailable"}`,
      );
    } else if (job.phase === "next_source") {
      const filters = JSON.parse(job.filters) as {
        ids: string[];
        index: number;
      };
      const index = filters.index + 1;
      if (index < filters.ids.length) {
        await next(
          "indexing",
          "Checking the next independent original source for additional explicitly disclosed metrics.",
          JSON.stringify({ ...filters, index }),
          filters.ids[index],
        );
        return;
      }
      await run(
        "UPDATE research_jobs SET status='complete',phase='complete',detail='Source preparation finished. Each metric reports its own verification or extraction state.',updated_at=? WHERE id=?",
        new Date().toISOString(),
        job.id,
      );
    }
  } catch (error) {
    await run(
      "UPDATE research_jobs SET status='failed',error=?,detail='Verified prior values are retained. Retry source preparation after its cooldown.',updated_at=? WHERE id=?",
      error instanceof Error
        ? error.message.slice(0, 800)
        : "Financial source preparation failed.",
      new Date().toISOString(),
      job.id,
    );
  }
}
