import type { Settings } from "./domain.ts";
export type BriefingFilters = {
  owner: string;
  mode: string;
  start: string;
  end: string;
  ticker?: string;
  category?: string;
  priority?: number;
  limit?: number;
  cursor?: string;
  routine_cursor?: string;
};
export function briefingPlan(
  f: BriefingFilters,
  s: Settings,
  section: "events" | "routine" = "events",
) {
  const where = [
      "p.owner=?",
      "a.ingestion_mode=?",
      "a.date>=?",
      "a.date<=?",
      "json_extract(a.payload,'$.canonical_event_id') IS NULL",
    ],
    values: (string | number)[] = [f.owner, f.mode, f.start, f.end];
  if (f.ticker) {
    where.push("a.ticker=?");
    values.push(f.ticker);
  }
  if (f.category) {
    where.push("a.category=?");
    values.push(f.category);
  }
  const score =
    "min(40,max(0,a.severity))+min(25,max(0,a.magnitude))+min(10,max(0,a.novelty))+min(10,max(0,a.evidence_coverage))+CASE WHEN a.category IN (SELECT value FROM json_each(?)) THEN 15 ELSE 0 END";
  const base = `SELECT a.*,(${score}) score,CASE WHEN a.category IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END enabled FROM announcements a JOIN portfolio_companies p ON p.ticker=a.ticker WHERE ${where.join(" AND ")}`;
  const args = [
      JSON.stringify(s.enabled_categories),
      JSON.stringify(s.enabled_categories),
      ...values,
    ],
    threshold = f.priority ?? s.min_priority;
  const important = "score>=? AND enabled=1",
    group = section === "events" ? important : `NOT (${important})`;
  const count = {
    sql: `WITH matched AS (${base}) SELECT count(*) total,sum(CASE WHEN ${important} THEN 1 ELSE 0 END) important_count,count(DISTINCT ticker) event_companies FROM matched`,
    values: [...args, threshold],
  };
  const cursor = section === "events" ? f.cursor : f.routine_cursor;
  let after = "",
    cv: (string | number)[] = [];
  if (cursor) {
    let c;
    try {
      c = JSON.parse(atob(cursor));
    } catch {
      throw new Error("Invalid briefing cursor");
    }
    if (
      !Array.isArray(c) ||
      c.length !== 3 ||
      !Number.isFinite(c[0]) ||
      !c.slice(1).every((x) => typeof x === "string" && x.length <= 160)
    )
      throw new Error("Invalid briefing cursor");
    after =
      " AND (score<? OR (score=? AND date<?) OR (score=? AND date=? AND id<?))";
    cv = [c[0], c[0], c[1], c[0], c[1], c[2]];
  }
  const limit = Math.max(1, Math.min(100, f.limit ?? 30));
  return {
    count,
    page: {
      sql: `WITH matched AS (${base}) SELECT id,date,payload,score FROM matched WHERE ${group}${after} ORDER BY score DESC,date DESC,id DESC LIMIT ?`,
      values: [...args, threshold, ...cv, limit + 1],
    },
    limit,
  };
}
export function monitoringCoverage(
  tickers: string[],
  configured: { ticker: string; provider: string; scope_end?: string }[],
  sync: {
    ticker: string;
    provider: string;
    status: string;
    last_success: string | null;
    last_attempt: string | null;
    pending?: number;
    manual_required?: number;
  }[],
  start: string,
  end: string,
) {
  const relevant = configured.filter(
      (c) => tickers.includes(c.ticker) && (!c.scope_end || c.scope_end >= end),
    ),
    monitored = [...new Set(relevant.map((c) => c.ticker))];
  const rows = monitored.map((ticker) => {
    const sources = relevant
      .filter((c) => c.ticker === ticker)
      .map((c) =>
        sync.find((s) => s.ticker === ticker && s.provider === c.provider),
      );
    const checked = sources.every(
      (s) =>
        s?.status === "success" &&
        s.last_attempt &&
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
          new Date(s.last_attempt),
        ) >= start &&
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
          new Date(s.last_attempt),
        ) <= end,
    );
    return {
      ticker,
      checked,
      status: checked
        ? "success"
        : sources.some((s) => s?.status === "failed")
          ? "unavailable"
          : sources.some((s) => s?.status === "partial")
            ? "partial"
            : sources.some((s) => s?.status === "manual_required")
              ? "manual_required"
              : "not_checked_in_window",
    };
  });
  return {
    monitored_companies: monitored.length,
    successfully_checked_companies: rows.filter((r) => r.checked).length,
    unavailable_source_companies: rows
      .filter((r) => r.status === "unavailable")
      .map((r) => r.ticker),
    never_configured_companies: tickers.filter((t) => !monitored.includes(t)),
    source_states: rows,
    last_successful_announcement_check:
      sync
        .filter((s) =>
          relevant.some(
            (c) => c.ticker === s.ticker && c.provider === s.provider,
          ),
        )
        .map((s) => s.last_success)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
  };
}
