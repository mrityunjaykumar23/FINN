import { all, one, run, lock, unlock, budget } from "../db/repository";
import { getPoints, yahooMarket, storeMarket } from "./server";
import { marketFreshness, type MarketSync } from "./market-state";
export async function queueMarketRefresh(tickers: string[], force = false) {
  const queued: string[] = [];
  let pending = 0,
    running = 0;
  let limited = false;
  for (const ticker of [...new Set(tickers)]) {
    const points = await getPoints(ticker, "live");
    const sync = await one<MarketSync>(
      "SELECT * FROM source_sync WHERE provider='market' AND ticker=?",
      ticker,
    );
    const state = marketFreshness(points.at(-1)?.date ?? null, sync);
    if (state.refreshing) {
      running++;
      continue;
    }
    const latest = points.at(-1),
      needsOHLC =
        !!latest &&
        (latest.open == null || latest.high == null || latest.low == null);
    if ((!state.stale && !force && !needsOHLC) || !state.can_refresh) continue;
    if (queued.length >= 3) {
      pending++;
      continue;
    }
    if (!(await lock(`market-refresh:${ticker}`, 90000))) continue;
    try {
      await budget("market:auto:hour", 120);
      await run(
        "INSERT INTO source_sync(provider,ticker,last_attempt,status) VALUES ('market',?,?,'queued') ON CONFLICT(provider,ticker) DO UPDATE SET last_attempt=excluded.last_attempt,status='queued',error=NULL",
        ticker,
        new Date().toISOString(),
      );
      queued.push(ticker);
    } catch {
      await unlock(`market-refresh:${ticker}`);
      limited = true;
      pending++;
      break;
    }
  }
  return { queued, pending, running, limited };
}
export async function runMarketRefresh(tickers: string[]) {
  await Promise.allSettled(
    tickers.map(async (ticker) => {
      try {
        await storeMarket(ticker, await yahooMarket(ticker));
      } catch (error) {
        await run(
          "UPDATE source_sync SET status='failed',error=? WHERE provider='market' AND ticker=?",
          error instanceof Error
            ? error.message.slice(0, 400)
            : "Market retrieval unavailable; retry after cooldown.",
          ticker,
        );
      } finally {
        await unlock(`market-refresh:${ticker}`);
      }
    }),
  );
}
export async function portfolioTickers(owner: string) {
  return (
    await all<{ ticker: string }>(
      "SELECT ticker FROM portfolio_companies WHERE owner=? ORDER BY ticker",
      owner,
    )
  ).map((c) => c.ticker);
}
