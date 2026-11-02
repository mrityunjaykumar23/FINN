import {
  calendar,
  exchangeDate,
  isExchangeTradingDate,
} from "./market-sessions.ts";
export function expectedCompletedSession(now = new Date()) {
  const today = exchangeDate(now);
  if (!today.startsWith(`${calendar.year}-`)) return null;
  const closed =
    +now >= +new Date(`${today}T15:50:00+05:30`) &&
    !calendar.special.includes(today);
  let day = new Date(`${today}T12:00:00Z`);
  if (!closed) day = new Date(+day - 86400000);
  for (let i = 0; i < 14; i++, day = new Date(+day - 86400000)) {
    const date = day.toISOString().slice(0, 10);
    if (isExchangeTradingDate(date)) return date;
  }
  return null;
}
export type MarketSync = {
  status: string;
  last_attempt: string | null;
  last_success: string | null;
  error?: string | null;
  details?: string | null;
};
export function marketFreshness(
  latest: string | null,
  sync?: MarketSync | null,
  now = new Date(),
) {
  const expected = expectedCompletedSession(now);
  const retryAt = sync?.last_attempt
    ? new Date(Date.parse(sync.last_attempt) + 5 * 60000).toISOString()
    : null;
  const recent = !!retryAt && retryAt > now.toISOString();
  return {
    status: sync?.status ?? "not_checked",
    observed_session: latest,
    expected_session: expected,
    stale: !latest || (!!expected && latest < expected),
    last_success: sync?.last_success ?? null,
    last_attempt: sync?.last_attempt ?? null,
    error: sync?.error ?? null,
    retry_at: recent ? retryAt : null,
    refreshing: !!sync && ["queued", "running"].includes(sync.status) && recent,
    can_refresh: !recent,
    source: "Yahoo Finance",
  };
}
