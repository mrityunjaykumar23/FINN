import type { Point } from "./domain.ts";
/** NSE capital-market circular CMTR71775 (2026); special budget session CMTR72349.
 * Muhurat date is known but its close must come from provider session metadata. */
export const calendar = {
  year: 2026,
  source: "https://nsearchives.nseindia.com/content/circulars/CMTR71775.pdf",
  holidays: [
    "2026-01-15",
    "2026-01-26",
    "2026-03-03",
    "2026-03-26",
    "2026-03-31",
    "2026-04-03",
    "2026-04-14",
    "2026-05-01",
    "2026-05-28",
    "2026-06-26",
    "2026-09-14",
    "2026-10-02",
    "2026-10-20",
    "2026-11-10",
    "2026-11-24",
    "2026-12-25",
  ],
  special: ["2026-02-01", "2026-11-08"],
};
export const exchangeDate = (time: Date | number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
export type MarketMeta = {
  longName?: string;
  symbol?: string;
  exchangeName?: string;
  exchangeTimezoneName?: string;
  regularMarketTime?: number;
  currentTradingPeriod?: { regular?: { start: number; end: number } };
};
export type DailyObservation = Point & {
  timestamp: number;
  open: number;
  high: number;
  low: number;
};
export const isExchangeTradingDate = (date: string) => {
  if (calendar.special.includes(date)) return true;
  const d = new Date(date + "T12:00:00+05:30").getUTCDay();
  return d !== 0 && d !== 6 && !calendar.holidays.includes(date);
};
export function completedSessions(
  rows: DailyObservation[],
  meta: MarketMeta,
  now = new Date(),
  bufferMinutes = 20,
  allowUnadjusted = false,
) {
  const today = exchangeDate(now),
    calendarKnown = today.startsWith("2026-");
  const valid = (p: DailyObservation) =>
    [p.open, p.high, p.low, p.close, p.volume].every(Number.isFinite) &&
    p.close > 0 &&
    ((allowUnadjusted && p.adjusted_close === null) ||
      (p.adjusted_close !== null &&
        Number.isFinite(p.adjusted_close) &&
        p.adjusted_close > 0)) &&
    p.high >= Math.max(p.open, p.close, p.low) &&
    p.low <= Math.min(p.open, p.close) &&
    p.volume >= 0;
  const regular = meta.currentTradingPeriod?.regular;
  const points = rows
    .filter((p) => valid(p) && p.date <= today && isExchangeTradingDate(p.date))
    .filter((p) => {
      if (p.date < today) return true;
      if (
        !calendarKnown ||
        meta.exchangeTimezoneName !== "Asia/Kolkata" ||
        !regular ||
        exchangeDate(regular.end * 1000) !== today
      )
        return false;
      const minimumClose = new Date(today + "T15:30:00+05:30").getTime();
      const close = regular.end * 1000;
      if (!calendar.special.includes(today) && close < minimumClose)
        return false;
      return (
        now.getTime() >= close + bufferMinutes * 60000 &&
        !!meta.regularMarketTime &&
        meta.regularMarketTime * 1000 >= close - 60000 &&
        exchangeDate(meta.regularMarketTime * 1000) === today &&
        p.volume > 0
      );
    })
    .map(({ date, close, adjusted_close, volume }) => ({
      date,
      close,
      adjusted_close,
      volume,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1)?.date ?? null;
  return {
    points,
    freshness: {
      exchange: "NSE",
      timezone: "Asia/Kolkata",
      exchange_date: today,
      latest_completed_session: latest,
      provider_observed_at: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : null,
      calendar_source: calendar.source,
      calendar_amendment:
        "https://nsearchives.nseindia.com/content/circulars/CMTR72260.pdf",
      calendar_year_verified: calendarKnown,
      post_close_buffer_minutes: bufferMinutes,
      current_session_included: latest === today,
      note:
        latest === today
          ? "Completed daily bar, session metadata and post-close buffer verified."
          : "Latest valid completed session retained; current session may be closed, unavailable, delayed or incomplete.",
    },
  };
}
