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
import { portfolioTickers } from "./market-refresh";
import { syncAnnouncements } from "./ingestion/announcements";
import { evaluateAlerts } from "./workflows";
import registered from "../data/announcement-sources.json";
import { financialError } from "./financial-errors";

type MonitorJob = {
  id: string;
  owner_id: string;
  ticker: string;
  filters: string;
  status: string;
  phase: string;
  attempts: number;
  updated_at: string;
  result: string | null;
  error: string | null;
};
type Progress = {
  tickers: string[];
  index: number;
  pending: number;
  results: unknown[];
};
export async function monitorState(owner: string, id: string) {
  const job = await one<MonitorJob>(
    "SELECT * FROM research_jobs WHERE id=? AND owner_id=? AND purpose='monitor'",
    id,
    owner,
  );
  if (!job)
    throw new ApiError(
      404,
      "monitor_not_found",
      "This monitoring check is unavailable in your workspace.",
    );
  const p = JSON.parse(job.filters) as Progress;
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    tickers: p.tickers,
    pending: p.pending,
    error: job.error,
    results: p.results,
    updated_at: job.updated_at,
  };
}
export async function createMonitor(owner: string) {
  const active = await one<{ id: string }>(
    "SELECT id FROM research_jobs WHERE owner_id=? AND purpose='monitor' AND status IN ('queued','running') ORDER BY created_at LIMIT 1",
    owner,
  );
  if (active) return monitorState(owner, active.id);
  const tickers = await portfolioTickers(owner),
    eligible: string[] = [];
  for (const ticker of tickers) {
    const row = await one<{ value: string }>(
      "SELECT value FROM meta WHERE key=?",
      `monitor-check:${ticker}`,
    );
    const check = row ? JSON.parse(row.value) : null;
    if (
      !check ||
      Date.parse(check.at) <
        Date.now() - (check.success ? 6 * 3600000 : 5 * 60000)
    )
      eligible.push(ticker);
  }
  if (!eligible.length)
    return {
      id: null,
      status: "complete",
      phase: "complete",
      tickers: [],
      pending: 0,
      results: [],
      error: null,
    };
  await budget(`monitor:owner:${owner}`, 12);
  await budget("monitor:global", 120);
  const selected: string[] = [];
  for (const t of eligible) {
    if (selected.length === 3) break;
    if (await lock(`monitor-company:${t}`, 180000)) selected.push(t);
  }
  if (!selected.length)
    return {
      id: null,
      status: "busy",
      phase: "discovery",
      tickers: [],
      pending: eligible.length,
      results: [],
      error: null,
    };
  const now = new Date().toISOString(),
    id = await sha(`${owner}:monitor:${now}:${selected.join(",")}`);
  try {
    await run(
      "INSERT INTO research_jobs(id,owner_id,ticker,question,filters,status,phase,attempts,purpose,created_at,updated_at) VALUES (?,?,?,?,?,'queued','discovery',0,'monitor',?,?)",
      id,
      owner,
      selected[0],
      "Automatic portfolio announcement check",
      JSON.stringify({
        tickers: selected,
        index: 0,
        pending: eligible.length - selected.length,
        results: [],
      }),
      now,
      now,
    );
  } catch (e) {
    for (const t of selected) await unlock(`monitor-company:${t}`);
    throw e;
  }
  return monitorState(owner, id);
}
export async function claimMonitor(owner: string, id: string) {
  await monitorState(owner, id);
  const expired = new Date(Date.now() - 90000).toISOString(),
    now = new Date().toISOString();
  await run(
    "UPDATE research_jobs SET status='failed',error='Monitoring worker repeatedly interrupted. Retry after the source cooldown.',updated_at=? WHERE id=? AND owner_id=? AND purpose='monitor' AND status='running' AND attempts>=3 AND updated_at<?",
    now,
    id,
    owner,
    expired,
  );
  return one<MonitorJob>(
    "UPDATE research_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND owner_id=? AND purpose='monitor' AND attempts<3 AND (status='queued' OR (status='running' AND updated_at<?)) RETURNING *",
    now,
    id,
    owner,
    expired,
  );
}
export async function runMonitor(job: MonitorJob) {
  const p = JSON.parse(job.filters) as Progress,
    ticker = p.tickers[p.index];
  try {
    if (job.phase === "evaluate") {
      await evaluateAlerts(job.owner_id, "live");
      await run(
        "UPDATE research_jobs SET status='complete',phase='complete',updated_at=? WHERE id=?",
        new Date().toISOString(),
        job.id,
      );
      return;
    }
    // A removed portfolio member is never monitored on this visitor's behalf.
    const member = await one(
      "SELECT ticker FROM portfolio_companies WHERE owner=? AND ticker=?",
      job.owner_id,
      ticker,
    );
    const result = member
      ? await syncAnnouncements([ticker], undefined, undefined, {
          stage: job.phase === "discovery" ? "discovery" : "ingestion",
          evaluate: false,
        })
      : { status: "removed" };
    p.results.push({ ticker, phase: job.phase, result });
    let phase = job.phase === "discovery" ? "ingestion" : "discovery";
    if (job.phase === "ingestion") {
      const providers = registered
        .filter((s) => s.ticker === ticker)
        .map((s) => s.provider);
      if (!providers.length) providers.push("announcements_directory");
      const sync = await all<{ status: string; failures: number }>(
        `SELECT status,failures FROM source_sync WHERE ticker=? AND provider IN (${providers.map(() => "?").join(",")})`,
        ticker,
        ...providers,
      );
      const success =
        sync.length > 0 &&
        sync.every((s) => s.status === "success" && !s.failures);
      await run(
        "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
        `monitor-check:${ticker}`,
        JSON.stringify({ at: new Date().toISOString(), success }),
      );
      await unlock(`monitor-company:${ticker}`);
      p.index++;
      if (p.index === p.tickers.length) phase = "evaluate";
    }
    await run(
      "UPDATE research_jobs SET filters=?,status='queued',phase=?,attempts=0,error=NULL,updated_at=? WHERE id=?",
      JSON.stringify(p),
      phase,
      new Date().toISOString(),
      job.id,
    );
  } catch (e) {
    if (ticker) {
      await run(
        "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
        `monitor-check:${ticker}`,
        JSON.stringify({ at: new Date().toISOString(), success: false }),
      );
      await unlock(`monitor-company:${ticker}`);
    }
    await run(
      "UPDATE research_jobs SET status='failed',error=?,updated_at=? WHERE id=?",
      financialError(e).message,
      new Date().toISOString(),
      job.id,
    );
  }
}
