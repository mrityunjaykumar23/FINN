import { all, one, run, sha, ApiError, db } from "../../db/repository";
import { safeSourceUrl, ingestPdf, getDocument } from "../server";
import { importFiling, trackSync, evaluateAll } from "../workflows";
import {
  locatePrimaryCandidates,
  rankCandidates,
  fetchPublicDirectory,
  parseOfficialTable,
} from "./discovery";
import registeredSources from "../../data/announcement-sources.json";
import { classify } from "../domain";
import { companySyncBatch } from "../query-plans";

/** Directory discovery is best effort, never an exchange-wide feed. Undated links
 * remain candidates for a verified manual import, not invented live announcements. */
export async function syncAnnouncements(
  tickers?: string[],
  after?: string,
  ownerAfter?: string,
) {
  const monitored =
    tickers ??
    (
      await all<{ ticker: string }>(
        "SELECT DISTINCT ticker FROM portfolio_companies ORDER BY ticker",
      )
    ).map((c) => c.ticker);
  const selection = companySyncBatch(monitored, after),
    batch = selection.batch;
  const results = [];
  for (const ticker of batch) {
    try {
      const source = registeredSources.find((s) => s.ticker === ticker),
        provider = source?.provider ?? "announcements_directory";
      const result = await trackSync(provider, ticker, async () => {
        let candidates;
        try {
          candidates = (
            source
              ? parseOfficialTable(
                  await fetchPublicDirectory(source.url),
                  source.url,
                  source.officialHost,
                  safeSourceUrl,
                )
              : await locatePrimaryCandidates(ticker, safeSourceUrl)
          ).candidates;
        } catch (e) {
          throw new ApiError(
            503,
            "discovery_source_failed",
            e instanceof Error && e.message.startsWith("Directory")
              ? e.message
              : "Original disclosure source could not be retrieved or parsed; manual filing import remains available.",
          );
        }
        if (source && !candidates.length)
          throw new ApiError(
            503,
            "provider_layout_changed",
            "No dated original filings could be parsed from the registered company source; manual import remains available.",
          );
        const previous = await one<{ cursor: string; last_success: string }>(
          "SELECT cursor,last_success FROM source_sync WHERE provider=? AND ticker=?",
          provider,
          ticker,
        );
        const dated = rankCandidates(
          candidates.filter((c) => c.published_at),
          "latest results",
        )
          .filter(
            (c) =>
              !previous?.cursor ||
              `${c.published_at}:${c.url}` > previous.cursor,
          )
          .sort((a, b) =>
            `${a.published_at}:${a.url}`.localeCompare(
              `${b.published_at}:${b.url}`,
            ),
          );
        let inserted = 0,
          duplicates = 0,
          cursor = previous?.cursor ?? "",
          failures = 0;
        const candidateRows = await Promise.all(
          candidates.map(async (c) =>
            db()
              .prepare(
                "INSERT OR IGNORE INTO discovery_candidates(id,ticker,url,title,type,published_at,period,status,checked_at) VALUES (?,?,?,?,?,?,?,?,?)",
              )
              .bind(
                await sha(`${ticker}:${c.url}`),
                ticker,
                c.url,
                c.title,
                c.type,
                c.published_at,
                c.period,
                "discovered",
                new Date().toISOString(),
              ),
          ),
        );
        try {
          for (let i = 0; i < candidateRows.length; i += 40)
            await db().batch(candidateRows.slice(i, i + 40));
        } catch {
          throw new ApiError(
            503,
            "discovery_storage_failed",
            "Original source candidates could not be persisted; no successful sync was recorded.",
          );
        }
        for (const c of previous?.cursor
          ? dated.slice(0, 2)
          : dated.slice(-2)) {
          try {
            const id = await ingestPdf(ticker, c.url, c.title, c.officialHost),
              doc = await getDocument(id);
            if (!doc)
              throw new ApiError(
                422,
                "source_missing",
                "Original document unavailable.",
              );
            const page =
              doc.pages.find(
                (p) => classify(p.text).category !== "unclassified",
              ) ?? doc.pages[0];
            if (!page)
              throw new ApiError(
                422,
                "event_unverified",
                "No identifiable source event; verified manual import required.",
              );
            const imported = await importFiling({
              ticker,
              document_id: id,
              headline: c.title,
              date: c.published_at!,
              evidence_page: page.page,
              mode: "live",
              exchange_filing_id: c.url,
            });
            inserted += imported.inserted;
            duplicates += imported.duplicates;
            await run(
              "UPDATE discovery_candidates SET status='indexed',document_id=?,detail=NULL WHERE ticker=? AND url=?",
              id,
              ticker,
              c.url,
            );
            cursor = `${c.published_at}:${c.url}`;
          } catch {
            failures++;
            break;
          } // Cursor never jumps over a failed item.
        }
        await run(
          "UPDATE discovery_candidates SET status='indexed',document_id=(SELECT d.id FROM documents d WHERE d.ticker=discovery_candidates.ticker AND d.url=discovery_candidates.url LIMIT 1) WHERE ticker=? AND EXISTS (SELECT 1 FROM documents d WHERE d.ticker=discovery_candidates.ticker AND d.url=discovery_candidates.url)",
          ticker,
        );
        return {
          discovered: candidates.length,
          inserted,
          duplicates,
          cursor,
          status: failures
            ? "partial"
            : candidates.some((c) => !c.published_at)
              ? "manual_required"
              : "success",
          undated: candidates.filter((c) => !c.published_at).length,
          pending: previous?.cursor ? Math.max(0, dated.length - 2) : 0,
          failures,
          limitations: [
            source?.note ??
              "Link-directory discovery is not a complete NSE/BSE announcement feed. Undated or inaccessible originals require protected, verified manual import.",
          ],
        };
      });
      results.push({ ticker, ...result });
    } catch (e) {
      results.push({
        ticker,
        status: "failed",
        error: e instanceof ApiError ? e.code : "source_unavailable",
      });
    }
  }
  // Notifications are evaluated independently of directory failures.
  const alerts = await evaluateAll("live", false, undefined, ownerAfter);
  return {
    results,
    alerts,
    next_company_cursor: selection.next_cursor,
    processed: batch.length,
  };
}
