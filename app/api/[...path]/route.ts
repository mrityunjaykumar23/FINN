import { scheduledStep } from "@/lib/scheduled-jobs";
import {
  queueMarketRefresh,
  runMarketRefresh,
  portfolioTickers,
} from "@/lib/market-refresh";
import {
  snapshotState,
  createSnapshot,
  claimSnapshot,
  runSnapshot,
} from "@/lib/financial-snapshot";
import { marketFreshness, type MarketSync } from "@/lib/market-state";
import { prepareDemo } from "@/lib/demo";
import { processDocumentJobs } from "@/lib/ingestion/document-jobs";
import { syncAnnouncements } from "@/lib/ingestion/announcements";
import { importFileBatch } from "@/lib/ingestion/local-file";
import { searchCompanies } from "@/lib/company-search";
import { companySyncBatch } from "@/lib/query-plans";
import { z } from "zod";
import { env, waitUntil } from "cloudflare:workers";
import {
  createResearchJob,
  researchJob,
  claimResearchJob,
  runResearchPhase,
} from "@/lib/research-jobs";
import {
  initialize,
  ownerFor,
  ensureOwner,
  portfolioFor,
  getSettings,
  all,
  one,
  run,
  resolveCompany,
  getPoints,
  getFilingById,
  getFilingPage,
  getDocument,
  eventDetail,
  digest,
  guidanceFor,
  research,
  yahooMarket,
  storeMarket,
  ingestPdf,
  ApiError,
} from "@/lib/server";
import { categories, normalizeTicker } from "@/lib/domain";
import type { Document, Metric } from "@/lib/types";

import { budget } from "@/db/repository";
import { providerStatus, extractDocument } from "@/lib/ai/service";
import {
  importFiling,
  evaluateAlerts,
  evaluateAll,
  systemStatus,
  trackSync,
} from "@/lib/workflows";
import { discoverDocuments } from "@/lib/server";
const settingsSchema = z.object({
  price_threshold: z.number().min(0.1).max(100),
  volume_multiplier: z.number().min(1).max(50),
  volume_lookback: z.number().int().min(5).max(60),
  min_priority: z.number().int().min(0).max(100),
  enabled_categories: z.array(z.enum(categories)).max(17),
  company_rules: z
    .record(
      z.object({
        price_threshold: z.number().min(0.1).max(100).optional(),
        volume_multiplier: z.number().min(1).max(50).optional(),
      }),
    )
    .refine(
      (v) =>
        Object.keys(v).every((k) => {
          try {
            return normalizeTicker(k) === k;
          } catch {
            return false;
          }
        }),
      "Invalid company ticker",
    ),
});
const questionSchema = z.object({
  ticker: z.string().min(1).max(32),
  question: z.string().trim().min(3).max(800),
  period: z
    .string()
    .regex(/^(?:Q[1-4]\s+)?FY\d{4}$/)
    .optional(),
  type: z.enum(["annual_report", "transcript", "results"]).optional(),
});
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_json", "Send valid JSON.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 50000) {
      await reader.cancel();
      throw new ApiError(413, "request_too_large", "Request exceeds 50 KB");
    }
    chunks.push(part.value);
  }
  if (length === 0) return {};
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "invalid_json", "Send valid JSON.");
  }
}
function admin(request: Request) {
  const token = (env as unknown as Record<string, string>).ADMIN_TOKEN;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`)
    throw new ApiError(
      403,
      "admin_required",
      "Ingestion requires a server-configured administrator token.",
    );
}
const tickerInput = z.object({ ticker: z.string().min(1).max(32) });
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (d) =>
      Number.isFinite(Date.parse(d)) &&
      new Date(d).toISOString().slice(0, 10) === d,
    "Use a valid YYYY-MM-DD date.",
  );
async function handle(request: Request) {
  let owner = "";
  const url = new URL(request.url);
  try {
    const path = decodeURIComponent(
        url.pathname.replace(/^\/api\//, ""),
      ).replace(/\/$/, ""),
      method = request.method;
    // Consume bounded mutation bodies before early error responses so Worker proxy streams remain reusable.
    const parsedBody =
      method !== "GET" && method !== "HEAD" && request.body
        ? await body(request)
        : {};

    if (
      method !== "GET" &&
      request.headers.has("origin") &&
      request.headers.get("origin") !== url.origin
    )
      throw new ApiError(
        403,
        "origin_rejected",
        "Cross-origin mutations are not permitted.",
      );
    await initialize();
    owner = await ownerFor(request);
    await ensureOwner(owner);
    const mode =
      url.searchParams.get("mode") === "live" ? "live" : "historical";
    if (
      method === "POST" &&
      [
        "research",
        "research/jobs",
        "market/refresh",
        "portfolio",
        "companies/refresh-documents",
      ].includes(path)
    ) {
      await budget(
        `session:${owner}:${path}`,
        path.startsWith("research") ? 40 : 12,
      );
      await budget(`global:${path}`, path.startsWith("research") ? 200 : 60);
    }
    let result: unknown;
    if (path === "health" && method === "GET")
      result = {
        status: "ok",
        database: "SQLite / D1",
        snapshot: "2025-04-22",
        market: "end-of-day",
        research: "primary-source retrieval",
        llm_configured: providerStatus().enabled,
      };
    else if (path === "status" && method === "GET")
      result = await systemStatus(owner);
    else if (path === "portfolio" && method === "GET")
      result = { companies: await portfolioFor(owner, mode), mode };
    else if (path === "portfolio" && method === "POST") {
      const input = tickerInput.parse(parsedBody),
        company = await resolveCompany(input.ticker);
      const count = await one<{ n: number }>(
        "SELECT count(*) n FROM portfolio_companies WHERE owner=?",
        owner,
      );
      if (
        (count?.n ?? 0) >= 30 &&
        !(await one(
          "SELECT ticker FROM portfolio_companies WHERE owner=? AND ticker=?",
          owner,
          company.ticker,
        ))
      )
        throw new ApiError(
          422,
          "portfolio_limit",
          "Monitor up to 30 companies.",
        );
      await run(
        "INSERT OR IGNORE INTO portfolio_companies(owner,ticker,created_at) VALUES (?,?,?)",
        owner,
        company.ticker,
        new Date().toISOString(),
      );
      // Membership is committed first. A provider failure cannot undo a valid addition.
      let market_refresh;
      try {
        market_refresh = await queueMarketRefresh([company.ticker]);
        if (market_refresh.queued.length)
          waitUntil(runMarketRefresh(market_refresh.queued));
      } catch {
        market_refresh = {
          queued: [],
          pending: 1,
          error:
            "Market refresh unavailable; the company remains in your portfolio.",
        };
      }
      result = {
        company,
        market_refresh,
        message: "Company added to your portfolio.",
      };
    } else if (path === "portfolio/refresh-market" && method === "POST") {
      await budget(`portfolio-market:${owner}`, 30);
      const input = z
        .object({ force: z.boolean().optional() })
        .parse(parsedBody);
      const refresh = await queueMarketRefresh(
        await portfolioTickers(owner),
        input.force,
      );
      if (refresh.queued.length) waitUntil(runMarketRefresh(refresh.queued));
      result = refresh;
    } else if (path.startsWith("portfolio/") && method === "DELETE") {
      await run(
        "DELETE FROM portfolio_companies WHERE owner=? AND ticker=?",
        owner,
        normalizeTicker(path.slice(10)),
      );
      result = { message: "Company removed from your portfolio." };
    } else if (path === "alerts/settings" && method === "GET")
      result = await getSettings(owner);
    else if (path === "alerts/settings" && method === "PUT") {
      const input = settingsSchema.parse(parsedBody);
      await run(
        "INSERT INTO alert_preferences(owner,settings) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET settings=excluded.settings",
        owner,
        JSON.stringify(input),
      );
      // Saving preferences never replays historical events or creates retrospective notifications.
      result = {
        settings: input,
        message:
          "Alert rules saved. Open a briefing or explicitly evaluate alerts to apply them.",
      };
    } else if (path === "digest" && method === "GET") {
      if (url.searchParams.has("limit"))
        z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(url.searchParams.get("limit"));
      if (url.searchParams.has("priority"))
        z.coerce
          .number()
          .min(0)
          .max(100)
          .parse(url.searchParams.get("priority"));
      for (const k of ["cursor", "routine_cursor"])
        if (url.searchParams.has(k))
          z.string().max(1000).parse(url.searchParams.get(k));
      for (const key of ["start", "end"])
        if (url.searchParams.has(key))
          dateSchema.parse(url.searchParams.get(key));
      if (url.searchParams.has("days"))
        z.coerce
          .number()
          .int()
          .min(1)
          .max(3650)
          .parse(url.searchParams.get("days"));
      if (
        (url.searchParams.get("start") ?? "") >
        (url.searchParams.get("end") ?? "9999")
      )
        throw new ApiError(
          422,
          "invalid_window",
          "The start date must precede the end date.",
        );
      if (url.searchParams.has("category"))
        z.enum(categories).parse(url.searchParams.get("category"));
      result = await digest(owner, url.searchParams);
    } else if (path === "announcements" && method === "GET") {
      const filters: {
        ticker?: string;
        start?: string;
        end?: string;
        category?: string;
        mode?: string;
      } = {};
      for (const key of ["ticker", "start", "end", "category", "mode"] as const)
        if (url.searchParams.has(key))
          filters[key] = url.searchParams.get(key)!;
      if (filters.ticker) filters.ticker = normalizeTicker(filters.ticker);
      if (filters.start) dateSchema.parse(filters.start);
      if (filters.end) dateSchema.parse(filters.end);
      if (filters.category) z.enum(categories).parse(filters.category);
      if (filters.mode) z.enum(["historical", "live"]).parse(filters.mode);
      result = await getFilingPage({
        ...filters,
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .parse(url.searchParams.get("limit") ?? 50),
        priority: url.searchParams.has("priority")
          ? z.coerce
              .number()
              .min(0)
              .max(100)
              .parse(url.searchParams.get("priority"))
          : undefined,
        cursor: url.searchParams.has("cursor")
          ? z.string().max(700).parse(url.searchParams.get("cursor"))
          : undefined,
      });
    } else if (path.startsWith("announcements/") && method === "GET") {
      const f = await getFilingById(
        z.string().min(1).max(160).parse(path.slice(14)),
      );
      if (!f)
        throw new ApiError(
          404,
          "filing_not_found",
          "This filing is unavailable.",
        );
      result = await eventDetail(f, await getSettings(owner));
    } else if (path === "alerts" && method === "GET") {
      const status = url.searchParams.get("status");
      if (status) z.enum(["unread", "read", "dismissed"]).parse(status);
      const rows = await all<{
        id: string;
        payload: string;
        status: string;
        read_at: string | null;
        dismissed_at: string | null;
        mode: string;
        observed_at: string;
        priority: number;
        event_type: string;
        triggered_at: string;
      }>(
        `SELECT * FROM alerts WHERE owner=? AND NOT EXISTS (SELECT 1 FROM announcements a WHERE a.id=alerts.announcement_id AND (json_extract(a.payload,'$.canonical_event_id') IS NOT NULL OR a.verification_status='review_required')) ${status ? "AND status=?" : ""} ORDER BY triggered_at DESC LIMIT 100`,
        owner,
        ...(status ? [status] : []),
      );
      result = {
        alerts: rows.map((r) => ({
          ...JSON.parse(r.payload),
          id: r.id,
          status: r.status,
          read_at: r.read_at,
          dismissed_at: r.dismissed_at,
          mode: r.mode,
          observed_at: r.observed_at,
          priority: r.priority,
          event_type: r.event_type,
          triggered_at: r.triggered_at,
        })),
        note: "Persisted in-app history. Threshold changes affect new evaluations; existing read and dismiss state is preserved.",
      };
    } else if (path.startsWith("alerts/") && method === "PATCH") {
      const { status } = z
          .object({ status: z.enum(["unread", "read", "dismissed"]) })
          .parse(parsedBody),
        id = path.slice(7),
        now = new Date().toISOString();
      const updated = await run(
        "UPDATE alerts SET status=?,read_at=CASE WHEN ?='read' THEN ? WHEN ?='unread' THEN NULL ELSE read_at END,dismissed_at=CASE WHEN ?='dismissed' THEN ? ELSE NULL END WHERE id=? AND owner=?",
        status,
        status,
        now,
        status,
        status,
        now,
        id,
        owner,
      );
      if (!updated.meta.changes)
        throw new ApiError(
          404,
          "alert_not_found",
          "Notification not found in this session.",
        );
      result = { id, status };
    } else if (path === "alerts/evaluate" && method === "POST")
      result = await evaluateAlerts(owner, mode);
    else if (path.startsWith("market/") && method === "GET")
      result = {
        ticker: normalizeTicker(path.slice(7)),
        points: await getPoints(normalizeTicker(path.slice(7)), mode),
        mode,
        source: "Yahoo Finance",
        freshness:
          mode === "live"
            ? await one(
                "SELECT last_attempt,last_success,status,error,details FROM source_sync WHERE provider='market' AND ticker=?",
                normalizeTicker(path.slice(7)),
              )
            : null,
        note: "Completed sessions only. Price-change calculations use adjusted close.",
      };
    else if (
      (path === "market/refresh" || path === "admin/ingest-market") &&
      method === "POST"
    ) {
      if (path.startsWith("admin/")) admin(request);
      const input = tickerInput.parse(parsedBody),
        ticker = normalizeTicker(input.ticker);
      await resolveCompany(ticker);
      const market = await trackSync("market", ticker, async () => {
        const m = await yahooMarket(ticker);
        const counts = await storeMarket(ticker, m);
        return { ...m, discovered: m.points.length, ...counts };
      });
      await evaluateAlerts(owner, "live");
      result = {
        ticker,
        sessions: market.points.length,
        freshness: market.freshness,
        retrieved_at: market.retrieved_at,
        run_id: market.run_id,
        note: "Completed sessions only; historical data remains separate.",
      };
    } else if (path === "companies/search" && method === "GET") {
      const q = z
        .string()
        .max(60)
        .parse(url.searchParams.get("q") ?? "");
      result = await searchCompanies(q, owner);
    } else if (
      /^companies\/[^/]+\/refresh-market$/.test(path) &&
      method === "POST"
    ) {
      const ticker = normalizeTicker(path.split("/")[1]);
      await resolveCompany(ticker);
      await budget(`company-market:${owner}`, 40);
      const input = z
        .object({ force: z.boolean().optional() })
        .parse(parsedBody);
      const refresh = await queueMarketRefresh([ticker], input.force);
      if (refresh.queued.length) waitUntil(runMarketRefresh(refresh.queued));
      result = refresh;
    } else if (/^companies\/[^/]+\/snapshot(?:\/advance)?$/.test(path)) {
      const ticker = normalizeTicker(path.split("/")[1]);
      await resolveCompany(ticker);
      if (method === "GET" && !path.endsWith("/advance"))
        result = await snapshotState(
          owner,
          ticker,
          url.searchParams.get("period") ?? undefined,
        );
      else if (method === "POST" && path.endsWith("/advance")) {
        await budget(`snapshot-advance:${owner}`, 120);
        const job = await claimSnapshot(owner, ticker);
        if (job) waitUntil(runSnapshot(job));
        result = await snapshotState(owner, ticker);
      } else if (method === "POST") {
        await budget(`snapshot-start:${owner}`, 40);
        const input = z
          .object({ force: z.boolean().optional() })
          .parse(parsedBody);
        result = await createSnapshot(owner, ticker, input.force);
      } else
        throw new ApiError(
          405,
          "method_not_allowed",
          "Use GET or POST for financial preparation.",
        );
    } else if (/^companies\/[^/]+\/overview$/.test(path) && method === "GET") {
      const ticker = normalizeTicker(path.split("/")[1]),
        company = await resolveCompany(ticker);
      const points = await getPoints(ticker, mode);
      const sync =
        mode === "live"
          ? await one<MarketSync>(
              "SELECT * FROM source_sync WHERE provider='market' AND ticker=?",
              ticker,
            )
          : null;
      result = {
        company,
        financial_snapshot: await snapshotState(owner, ticker),
        metrics: await all<Metric>(
          "SELECT * FROM financial_metrics WHERE ticker=? AND verification_status<>'unverified'",
          ticker,
        ),
        documents: await all<Omit<Document, "pages">>(
          "SELECT d.*,j.status financial_extraction_status,j.error financial_extraction_error FROM documents d LEFT JOIN document_jobs j ON j.id=(SELECT x.id FROM document_jobs x WHERE x.document_id=d.id OR (x.ticker=d.ticker AND x.url=d.url) ORDER BY x.updated_at DESC LIMIT 1) WHERE d.ticker=?",
          ticker,
        ),
        points,
        market_freshness:
          mode === "live"
            ? marketFreshness(points.at(-1)?.date ?? null, sync)
            : null,
        guidance: await guidanceFor(ticker),
        mode,
      };
    } else if (path === "research/jobs" && method === "POST") {
      const input = questionSchema.parse(parsedBody),
        ticker = normalizeTicker(input.ticker);
      await resolveCompany(ticker);
      result = await createResearchJob(owner, ticker, input.question, {
        ...(input.type && { type: input.type }),
        ...(input.period && { period: input.period }),
      });
    } else if (
      /^research\/jobs\/[a-f0-9]{64}$/.test(path) &&
      method === "GET"
    ) {
      result = await researchJob(owner, path.split("/")[2]);
    } else if (
      /^research\/jobs\/[a-f0-9]{64}\/advance$/.test(path) &&
      method === "POST"
    ) {
      await budget(`research-advance:${owner}`, 180);
      const id = path.split("/")[2],
        job = await claimResearchJob(owner, id);
      if (job) waitUntil(runResearchPhase(job));
      result = await researchJob(owner, id);
    } else if (path === "research" && method === "POST") {
      const input = questionSchema.parse(parsedBody),
        ticker = normalizeTicker(input.ticker);
      await resolveCompany(ticker);
      result = await research(ticker, input.question, {
        period: input.period,
        type: input.type,
      });
    } else if (path === "guidance" && method === "GET")
      result = { comparisons: await guidanceFor() };
    else if (/^research\/[^/]+\/guidance$/.test(path) && method === "GET")
      result = {
        comparisons: await guidanceFor(normalizeTicker(path.split("/")[1])),
      };
    else if (/^research\/[^/]+\/documents$/.test(path) && method === "GET")
      result = {
        documents: await all<Omit<Document, "pages">>(
          "SELECT * FROM documents WHERE ticker=?",
          normalizeTicker(path.split("/")[1]),
        ),
      };
    else if (path.startsWith("documents/") && method === "GET") {
      result = await getDocument(z.string().max(100).parse(path.slice(10)));
      if (!result)
        throw new ApiError(
          404,
          "document_not_found",
          "Source document is unavailable.",
        );
    } else if (path === "jobs/scheduled" && method === "POST") {
      // A dedicated service credential protects scheduled writes even on a public Site.
      const jobToken = (env as unknown as Record<string, string>)
        .SITES_SCHEDULED_TOKEN;
      if (
        !jobToken ||
        request.headers.get("X-Finn-Job-Authorization") !== `Bearer ${jobToken}`
      )
        admin(request);
      await budget("scheduled-updates", 120, 3600000);
      const input = z
        .object({
          phase: z.enum([
            "market",
            "discovery",
            "ingestion",
            "evaluate",
            "documents",
          ]),
          after: z.string().max(32).optional(),
          owner_after: z.string().max(100).optional(),
        })
        .parse(parsedBody);
      result = { phase: input.phase, result: await scheduledStep(input) };
    } else if (path === "admin/ingest-announcements" && method === "POST") {
      admin(request);
      const input = z
        .object({
          ticker: z.string().max(32),
          document_id: z.string().max(100).optional(),
          url: z.string().url().optional(),
          headline: z.string().min(5).max(240),
          date: dateSchema,
          evidence_page: z.number().int().positive(),
          mode: z.enum(["historical", "live"]).default("live"),
          reprocess: z.boolean().default(false),
          event_quote: z.string().min(20).max(20000).optional(),
          exchange_filing_id: z.string().min(1).max(500).optional(),
          publication_precision: z
            .enum(["date", "company_recorded_datetime"])
            .optional(),
          publication_timezone: z.string().max(64).optional(),
          source_timestamp: z.string().datetime({ offset: true }).optional(),
        })
        .refine(
          (v) => !!v.document_id || !!v.url,
          "Supply document_id or primary PDF URL",
        )
        .parse(parsedBody);
      result = await importFiling({
        ...input,
        ticker: normalizeTicker(input.ticker),
      });
      await evaluateAlerts(owner, input.mode);
    } else if (path === "admin/import-file-batch" && method === "POST") {
      admin(request);
      const input = z
        .object({
          ticker: z.string().max(32),
          url: z.string().url().max(1000),
          title: z.string().max(200),
          type: z.enum([
            "annual_report",
            "results",
            "transcript",
            "presentation",
            "announcement",
          ]),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          total_pages: z.number().int().min(1).max(1000),
          expected_chunks: z.number().int().min(1).max(20000),
          chunks: z
            .array(
              z.object({
                page: z.number().int().min(1).max(1000),
                index: z.number().int().min(0).max(1000),
                text: z.string().max(2100),
              }),
            )
            .min(1)
            .max(12),
          final: z.boolean(),
        })
        .parse(parsedBody);
      result = await importFileBatch({
        ...input,
        ticker: normalizeTicker(input.ticker),
      });
    } else if (path === "admin/ingest-document" && method === "POST") {
      admin(request);
      const input = z
        .object({
          ticker: z.string().max(32),
          url: z.string().url(),
          title: z.string().max(200),
        })
        .parse(parsedBody);
      const ticker = normalizeTicker(input.ticker);
      await resolveCompany(ticker);
      result = { id: await ingestPdf(ticker, input.url, input.title) };
    } else if (path === "admin/prepare-demo" && method === "POST") {
      admin(request);
      result = await prepareDemo();
    } else if (path === "admin/document-jobs" && method === "GET") {
      admin(request);
      result = {
        jobs: await all(
          "SELECT id,ticker,title,type,status,attempts,next_retry,error,document_id,updated_at FROM document_jobs ORDER BY CASE WHEN status='pending' THEN 0 WHEN status='failed' THEN 1 ELSE 2 END,created_at,id LIMIT 50",
        ),
      };
    } else if (path === "admin/process-document-jobs" && method === "POST") {
      admin(request);
      const input = z
        .object({
          ticker: z.string().max(32).optional(),
          id: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          limit: z.number().int().min(1).max(2).default(1),
        })
        .parse(parsedBody);
      result = await processDocumentJobs(
        input.limit,
        input.ticker ? normalizeTicker(input.ticker) : undefined,
        input.id,
      );
    } else if (path === "admin/discover-documents" && method === "POST") {
      admin(request);
      const input = tickerInput.parse(parsedBody);
      const ticker = normalizeTicker(input.ticker);
      await resolveCompany(ticker);
      result = await discoverDocuments(ticker);
    } else if (path === "admin/extract-document" && method === "POST") {
      admin(request);
      const input = z
          .object({ document_id: z.string().max(100) })
          .parse(parsedBody),
        d = await getDocument(input.document_id);
      if (!d)
        throw new ApiError(404, "document_not_found", "Document not found.");
      result = await extractDocument(d.ticker, d.id);
    } else if (path === "admin/evaluate-alerts" && method === "POST") {
      admin(request);
      const input = z
        .object({
          refresh_market: z.boolean().default(false),
          tickers: z.array(z.string().max(32)).max(30).optional(),
          owner_after: z.string().max(100).optional(),
        })
        .parse(parsedBody);
      result = await evaluateAll(
        mode,
        input.refresh_market,
        input.tickers?.map(normalizeTicker),
        input.owner_after,
      );
    } else if (
      (path === "admin/sync-announcements" ||
        path === "admin/sync-intelligence") &&
      method === "POST"
    ) {
      admin(request);
      const input = z
        .object({
          tickers: z.array(z.string().max(32)).max(30).optional(),
          after: z.string().max(32).optional(),
          owner_after: z.string().max(100).optional(),
          stage: z.enum(["discovery", "ingestion"]).optional(),
          evaluate: z.boolean().optional(),
        })
        .parse(parsedBody);
      const tickers = input.tickers?.map(normalizeTicker);
      const marketTickers =
        (tickers ? companySyncBatch(tickers, input.after).batch : undefined) ??
        (
          await all<{ ticker: string }>(
            "SELECT DISTINCT ticker FROM portfolio_companies WHERE ticker>? ORDER BY ticker LIMIT 3",
            input.after ?? "",
          )
        ).map((c) => c.ticker);
      const market =
        path === "admin/sync-intelligence"
          ? await evaluateAll(
              "live",
              true,
              marketTickers.slice(0, 3),
              input.owner_after,
            )
          : undefined;
      result = {
        market,
        announcements: await syncAnnouncements(
          tickers,
          input.after,
          input.owner_after,
          { stage: input.stage, evaluate: input.evaluate },
        ),
      };
    } else if (path === "companies/refresh-documents" && method === "POST") {
      const input = tickerInput.parse(parsedBody),
        ticker = normalizeTicker(input.ticker);
      await resolveCompany(ticker);
      result = await discoverDocuments(ticker);
    } else
      throw new ApiError(
        404,
        "route_not_found",
        "This API route does not exist.",
      );
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    headers.set(
      "Set-Cookie",
      `finn_session=${owner.slice(7)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${url.protocol === "https:" ? "; Secure" : ""}`,
    );
    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    let status = 503,
      code = "service_unavailable",
      message =
        "FINN could not complete this request. The source or database may be temporarily unavailable. Please retry.";
    if (e instanceof z.ZodError) {
      status = 422;
      code = "validation_error";
      message = e.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else if (e instanceof ApiError) {
      status = e.status;
      code = e.code;
      message = e.message;
    } else if (
      e instanceof Error &&
      /^Invalid (briefing|announcement) cursor$/.test(e.message)
    ) {
      status = 422;
      code = "invalid_cursor";
      message = e.message;
    } else if (
      e instanceof Error &&
      e.message.startsWith("Enter a valid NSE ticker")
    ) {
      status = 422;
      code = "invalid_ticker";
      message = e.message;
    } else console.error("FINN API failure", "internal_failure");
    return Response.json(
      { error: { code, message } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
