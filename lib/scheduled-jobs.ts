import { calendar, exchangeDate } from "./market-sessions";
import { all } from "../db/repository";
import { evaluateAll } from "./workflows";
import { syncAnnouncements } from "./ingestion/announcements";
import { processDocumentJobs } from "./ingestion/document-jobs";
import { queueMarketRefresh, runMarketRefresh } from "./market-refresh";
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
    const rows = await all<{ ticker: string }>(
      "SELECT DISTINCT ticker FROM portfolio_companies WHERE ticker>? ORDER BY ticker LIMIT 4",
      input.after ?? "",
    );
    const results = [];
    for (const c of rows.slice(0, 3)) {
      try {
        const queued = await queueMarketRefresh([c.ticker]);
        if (queued.queued.length) await runMarketRefresh(queued.queued);
        results.push({ ticker: c.ticker, ...queued });
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
    return syncAnnouncements(undefined, input.after, undefined, {
      stage: input.phase,
      evaluate: false,
    });
  if (input.phase === "evaluate")
    return evaluateAll("live", false, undefined, input.owner_after);
  return processDocumentJobs(1);
}
