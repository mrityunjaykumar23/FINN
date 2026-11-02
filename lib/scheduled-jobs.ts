import {
  calendar,
  exchangeDate,
  isExchangeTradingDate,
} from "./market-sessions";
import { all } from "../db/repository";
import { yahooMarket, storeMarket } from "./server";
import { trackSync, evaluateAll } from "./workflows";
import { syncAnnouncements } from "./ingestion/announcements";
import { processDocumentJobs } from "./ingestion/document-jobs";
import sources from "../data/announcement-sources.json";
export async function scheduledStep(input: {
  phase: "market" | "discovery" | "ingestion" | "evaluate" | "documents";
  after?: string;
  owner_after?: string;
}) {
  if (input.phase === "market") {
    const today = exchangeDate(new Date());
    if (!today.startsWith(String(calendar.year) + "-"))
      return {
        status: "manual_required",
        reason: "Verified NSE calendar requires maintenance before a new year.",
        next_company_cursor: null,
      };
    if (!isExchangeTradingDate(today))
      return {
        skipped: true,
        reason: "NSE non-trading date; no source requests made.",
        next_company_cursor: null,
      };
    const rows = await all<{ ticker: string }>(
      "SELECT DISTINCT ticker FROM portfolio_companies WHERE ticker>? ORDER BY ticker LIMIT 4",
      input.after ?? "",
    );
    const results = [];
    for (const c of rows.slice(0, 3)) {
      try {
        results.push({
          ticker: c.ticker,
          ...(await trackSync("market", c.ticker, async () => {
            const m = await yahooMarket(c.ticker);
            return {
              ...(await storeMarket(c.ticker, m)),
              discovered: m.points.length,
              freshness: m.freshness,
            };
          })),
        });
      } catch (e) {
        results.push({
          ticker: c.ticker,
          status: "failed",
          error:
            e instanceof Error ? e.message.slice(0, 400) : "Source unavailable",
        });
      }
    }
    return {
      results,
      next_company_cursor: rows.length > 3 ? rows[2].ticker : null,
    };
  }
  if (input.phase === "discovery" || input.phase === "ingestion")
    return syncAnnouncements(
      [...new Set(sources.map((s) => s.ticker))],
      input.after,
      undefined,
      { stage: input.phase, evaluate: false },
    );
  if (input.phase === "evaluate")
    return evaluateAll("live", false, undefined, input.owner_after);
  return processDocumentJobs(1);
}
