import {
  completedSessions,
  exchangeDate,
  type MarketMeta,
} from "./market-sessions.ts";
export type YahooResult = {
  timestamp: number[];
  meta: MarketMeta & {
    symbol?: string;
    currency?: string;
    firstTradeDate?: number;
    dataGranularity?: string;
    validRanges?: string[];
  };
  indicators: {
    quote: {
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }[];
    adjclose?: { adjclose: (number | null)[] }[];
  };
};
export function verifiedYahooDaily(
  value: YahooResult,
  ticker: string,
  now = new Date(),
) {
  if (value.meta.symbol?.toUpperCase() !== ticker.toUpperCase())
    throw Error("Yahoo did not confirm the requested ticker.");
  if (value.meta.dataGranularity !== "1d")
    throw Error(
      "Yahoo returned intraday bars, not verified daily observations.",
    );
  const dates = value.timestamp.map((t) => exchangeDate(t * 1000));
  if (new Set(dates).size !== dates.length)
    throw Error(
      "Multiple provider bars for one session cannot be treated as separate EOD sessions.",
    );
  const listing = value.meta.firstTradeDate
    ? exchangeDate(value.meta.firstTradeDate * 1000)
    : null;
  const q = value.indicators.quote[0],
    a = value.indicators.adjclose?.[0]?.adjclose;
  const rows = value.timestamp
    .map((t, i) => ({
      timestamp: t,
      date: dates[i],
      open: q.open?.[i] ?? NaN,
      high: q.high?.[i] ?? NaN,
      low: q.low?.[i] ?? NaN,
      close: q.close?.[i] ?? NaN,
      adjusted_close: a?.[i] ?? null,
      volume: q.volume?.[i] ?? NaN,
    }))
    .filter((p) => !listing || p.date >= listing);
  const result = completedSessions(rows, value.meta, now, 20, true);
  return {
    ...result,
    freshness: {
      ...result.freshness,
      listing_date: listing,
      adjustment: "provider_adjusted_close",
    },
  };
}
