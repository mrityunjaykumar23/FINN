import { all, one, run, sha, ApiError, db } from "../../db/repository";
import {
  safeSourceUrl,
  ingestPdf,
  getDocument,
  resolveCompany,
} from "../server";
import { importFiling, trackSync, evaluateAll } from "../workflows";
import registeredSources from "../../data/announcement-sources.json";
import { companySyncBatch } from "../query-plans";
import { discoverSource, type SourceConfig } from "./adapters";
import { matchFilingEvents } from "../event-evidence";
type Pending = {
  id: string;
  url: string;
  title: string;
  published_at: string;
  external_id: string;
  type: string;
  publication_precision: string;
  publication_timezone: string | null;
  source_timestamp: string | null;
  attempts: number;
};
/** Discovery and import progress are independent; stored candidates are never discarded by a cursor. */
export async function syncAnnouncements(
  tickers?: string[],
  after?: string,
  ownerAfter?: string,
  options: { stage?: "discovery" | "ingestion"; evaluate?: boolean } = {},
) {
  const monitored =
    tickers ??
    (
      await all<{ ticker: string }>(
        "SELECT DISTINCT ticker FROM portfolio_companies ORDER BY ticker",
      )
    ).map((c) => c.ticker);
  const selection = companySyncBatch(monitored, after),
    results = [];
  for (const ticker of selection.batch) {
    const configs = registeredSources.filter(
      (s) => s.ticker === ticker,
    ) as SourceConfig[];
    for (const source of configs.length ? configs : [undefined]) {
      const provider = source?.provider ?? "announcements_directory";
      try {
        await resolveCompany(ticker);
        const result = await trackSync(
          options.stage === "ingestion"
            ? `announcements_ingestion:${provider}`
            : provider,
          ticker,
          async () => {
            const previous = await one<{ discovery_cursor: string | null }>(
              "SELECT discovery_cursor FROM source_sync WHERE provider=? AND ticker=?",
              provider,
              ticker,
            );
            const discovered =
              options.stage === "ingestion"
                ? {
                    items: [],
                    total: 0,
                    next_cursor: previous?.discovery_cursor ?? null,
                    coverage:
                      "Processing already discovered candidates; no source discovery check performed.",
                  }
                : await discoverSource(
                    source,
                    ticker,
                    safeSourceUrl,
                    previous?.discovery_cursor,
                  );
            const statements = await Promise.all(
              discovered.items.map(async (c) =>
                db()
                  .prepare(
                    "INSERT INTO discovery_candidates(id,ticker,url,title,type,published_at,period,status,checked_at,provider,external_id,publication_precision,publication_timezone,verification_status,processing_status,source_timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ticker,url) DO UPDATE SET title=excluded.title,published_at=coalesce(excluded.published_at,discovery_candidates.published_at),provider=excluded.provider,external_id=excluded.external_id,publication_precision=excluded.publication_precision,publication_timezone=excluded.publication_timezone,verification_status=excluded.verification_status,source_timestamp=excluded.source_timestamp,checked_at=excluded.checked_at",
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
                    c.discovered_at,
                    c.provider,
                    c.external_id,
                    c.publication_precision,
                    c.publication_timezone,
                    c.verification_status,
                    c.published_at ? "pending" : "review",
                    c.source_timestamp ?? null,
                  ),
              ),
            );
            for (let i = 0; i < statements.length; i += 30)
              await db().batch(statements.slice(i, i + 30));
            const now = new Date().toISOString();
            const queue = await all<Pending>(
              "SELECT * FROM discovery_candidates WHERE ticker=? AND provider=? AND published_at IS NOT NULL AND verification_status='official_page' AND processing_status IN ('pending','failed') AND attempts<3 AND (next_retry IS NULL OR next_retry<=?) ORDER BY published_at DESC,id DESC LIMIT 2",
              ticker,
              provider,
              now,
            );
            let inserted = 0,
              duplicates = 0,
              failures = 0,
              cursor: string | undefined;
            for (const c of options.stage === "discovery" ? [] : queue) {
              try {
                if (c.type === "annual_report" || c.type === "transcript") {
                  await run(
                    "UPDATE discovery_candidates SET processing_status='review',detail='Report/transcript requires event review; not treated as a new event automatically.' WHERE id=?",
                    c.id,
                  );
                  continue;
                }
                const id = await ingestPdf(
                    ticker,
                    c.url,
                    c.title,
                    source?.officialHost,
                  ),
                  doc = await getDocument(id);
                if (!doc) throw new Error("Source not indexed");
                const events = matchFilingEvents(doc.pages, c.title);
                if (!events.length) {
                  await run(
                    "UPDATE discovery_candidates SET document_id=?,status='indexed',processing_status='review',detail='No exact event-specific supporting passage; review required.' WHERE id=?",
                    id,
                    c.id,
                  );
                  continue;
                }
                for (const event of events) {
                  const imported = await importFiling({
                    ticker,
                    document_id: id,
                    headline: event.headline,
                    date: c.published_at,
                    evidence_page: event.page,
                    event_quote: event.quote,
                    category: event.category,
                    source_provider: provider,
                    publication_precision: c.publication_precision,
                    publication_timezone: c.publication_timezone ?? undefined,
                    source_timestamp: c.source_timestamp ?? undefined,
                    mode: "live",
                    exchange_filing_id: c.external_id,
                  });
                  inserted += imported.inserted;
                  duplicates += imported.duplicates;
                }
                await run(
                  "UPDATE discovery_candidates SET document_id=?,status='indexed',processing_status='imported',detail=NULL,next_retry=NULL WHERE id=?",
                  id,
                  c.id,
                );
                cursor = c.external_id;
              } catch (e) {
                failures++;
                await run(
                  "UPDATE discovery_candidates SET attempts=attempts+1,processing_status=CASE WHEN attempts>=2 THEN 'review' ELSE 'failed' END,next_retry=?,detail=? WHERE id=?",
                  new Date(Date.now() + 300000).toISOString(),
                  e instanceof Error
                    ? e.message.slice(0, 600)
                    : "original_source_unavailable",
                  c.id,
                );
                break;
              }
            }
            const counts = await one<{ pending: number; manual: number }>(
              "SELECT sum(processing_status IN ('pending','failed')) pending,sum(processing_status='review') manual FROM discovery_candidates WHERE ticker=? AND provider=?",
              ticker,
              provider,
            );
            return {
              discovered: discovered.items.length,
              inserted,
              duplicates,
              failures,
              cursor,
              pending: counts?.pending ?? 0,
              manual_required: counts?.manual ?? 0,
              discovery_cursor: discovered.next_cursor,
              status: failures
                ? "partial"
                : source
                  ? "success"
                  : "manual_required",
              coverage: {
                source: source?.url ?? "original link directory",
                note: discovered.coverage,
                total_source_items: discovered.total,
                discovery_has_more: !!discovered.next_cursor,
                dated_source: !!source,
                never_claims_exchange_wide: true,
              },
            };
          },
        );
        results.push({ ticker, provider, ...result });
      } catch (e) {
        results.push({
          ticker,
          provider,
          status: "failed",
          error: e instanceof ApiError ? e.code : "source_unavailable",
        });
      }
    }
  }
  const alerts =
    options.evaluate === false
      ? undefined
      : await evaluateAll("live", false, undefined, ownerAfter);
  return {
    results,
    alerts,
    next_company_cursor: selection.next_cursor,
    processed: selection.batch.length,
  };
}
