import { z } from "zod";
import { env } from "cloudflare:workers";
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
  getFilings,
  getDocument,
  eventDetail,
  digest,
  guidanceFor,
  research,
  yahooMarket,
  storeMarket,
  ingestPdf,
  sha,
  ApiError,
} from "@/lib/server";
import {
  categories,
  normalizeTicker,
  classify,
  type Filing,
} from "@/lib/domain";
import type { Company, Document, Metric } from "@/lib/types";

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
  period: z.string().max(60).optional(),
  type: z.enum(["annual_report", "transcript", "results"]).optional(),
});
async function body(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 50000)
    throw new ApiError(413, "request_too_large", "Request exceeds 50 KB");
  try {
    return await request.json();
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
async function handle(request: Request) {
  let owner = "";
  try {
    const url = new URL(request.url),
      path = decodeURIComponent(url.pathname.replace(/^\/api\//, "")).replace(
        /\/$/,
        "",
      ),
      method = request.method;
    await initialize();
    owner = await ownerFor(request);
    await ensureOwner(owner);
    const mode =
      url.searchParams.get("mode") === "live" ? "live" : "historical";
    let result: unknown;
    if (path === "health" && method === "GET")
      result = {
        status: "ok",
        database: "SQLite / D1",
        snapshot: "2025-04-22",
        market: "end-of-day",
        research: "primary-source retrieval",
        llm_configured: !!(env as unknown as Record<string, string>)
          .LLM_API_KEY,
      };
    else if (path === "portfolio" && method === "GET")
      result = { companies: await portfolioFor(owner, mode), mode };
    else if (path === "portfolio" && method === "POST") {
      const input = z
        .object({ ticker: z.string().max(32) })
        .parse(await body(request));
      const company = await resolveCompany(input.ticker);
      const count = await one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM portfolio_companies WHERE owner=?",
        owner,
      );
      if ((count?.n ?? 0) >= 50)
        throw new ApiError(
          422,
          "portfolio_limit",
          "The prototype supports up to 50 portfolio companies.",
        );
      await run(
        "INSERT OR IGNORE INTO portfolio_companies(owner,ticker,created_at) VALUES (?,?,?)",
        owner,
        company.ticker,
        new Date().toISOString(),
      );
      result = { company, message: "Company added to your portfolio." };
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
      const input = settingsSchema.parse(await body(request));
      await run(
        "INSERT OR REPLACE INTO alert_preferences(owner,settings) VALUES (?,?)",
        owner,
        JSON.stringify(input),
      );
      result = {
        settings: input,
        message: "Alert rules saved. Briefing alerts will be recalculated.",
      };
    } else if (path === "digest" && method === "GET") {
      for (const key of ["start", "end"]) {
        const value = url.searchParams.get(key);
        if (
          value &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value)
        )
          throw new ApiError(
            422,
            "invalid_date",
            "Use a valid YYYY-MM-DD date.",
          );
      }
      if (
        url.searchParams.has("days") &&
        (!Number.isFinite(Number(url.searchParams.get("days"))) ||
          Number(url.searchParams.get("days")) < 1)
      )
        throw new ApiError(
          422,
          "invalid_window",
          "Days must be a positive number.",
        );
      if (
        (url.searchParams.get("start") ?? "") >
        (url.searchParams.get("end") ?? "9999")
      )
        throw new ApiError(
          422,
          "invalid_window",
          "The start date must precede the end date.",
        );
      result = await digest(owner, url.searchParams);
    } else if (path === "announcements" && method === "GET")
      result = { announcements: await getFilings() };
    else if (path.startsWith("announcements/") && method === "GET") {
      const f = (await getFilings()).find((f) => f.id === path.slice(14));
      if (!f)
        throw new ApiError(
          404,
          "filing_not_found",
          "This filing is unavailable.",
        );
      result = await eventDetail(f, await getSettings(owner));
    } else if (path === "alerts" && method === "GET")
      result = {
        alerts: (
          await all<{ payload: string }>(
            "SELECT payload FROM alerts WHERE owner=? ORDER BY triggered_at DESC LIMIT 100",
            owner,
          )
        ).map((a) => JSON.parse(a.payload)),
        note: "Stored in-app EOD alerts, recalculated when opening a briefing.",
      };
    else if (path.startsWith("market/") && method === "GET")
      result = {
        ticker: normalizeTicker(path.slice(7)),
        points: await getPoints(normalizeTicker(path.slice(7)), mode),
        mode,
        source: "Yahoo Finance",
        note: "Daily close; not an intraday quote. Price-change calculations use adjusted close.",
      };
    else if (path === "market/refresh" && method === "POST") {
      const input = z
        .object({ ticker: z.string().max(32) })
        .parse(await body(request));
      const ticker = normalizeTicker(input.ticker),
        market = await yahooMarket(ticker);
      await storeMarket(ticker, market);
      result = {
        ticker,
        sessions: market.points.length,
        retrieved_at: market.retrieved_at,
        note: "Completed sessions only. Today's potentially unfinished session is excluded.",
      };
    } else if (path === "companies/search" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
      const escaped = q.replace(/[\\%_]/g, "\\$&");
      const local = await all<Company>(
        "SELECT * FROM companies WHERE ticker LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 12",
        `%${escaped}%`,
        `%${escaped}%`,
      );
      if (!local.length && q) {
        try {
          local.push((await resolveCompany(q)) as Company);
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw new ApiError(
            422,
            "invalid_ticker",
            "No matching company. Search by a valid NSE ticker.",
          );
        }
      }
      result = { companies: local };
    } else if (/^companies\/[^/]+\/overview$/.test(path) && method === "GET") {
      const ticker = normalizeTicker(path.split("/")[1]),
        company = await resolveCompany(ticker);
      result = {
        company,
        metrics: await all<Metric>(
          "SELECT * FROM financial_metrics WHERE ticker=?",
          ticker,
        ),
        documents: await all<Omit<Document, "pages">>(
          "SELECT * FROM documents WHERE ticker=?",
          ticker,
        ),
        points: await getPoints(ticker, mode),
        guidance: await guidanceFor(ticker),
        mode,
      };
    } else if (path === "research" && method === "POST") {
      const input = questionSchema.parse(await body(request)),
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
      result = await getDocument(path.slice(10));
      if (!result)
        throw new ApiError(
          404,
          "document_not_found",
          "Source document is unavailable.",
        );
    } else if (path === "admin/ingest-market" && method === "POST") {
      admin(request);
      const input = z
        .object({ ticker: z.string().max(32) })
        .parse(await body(request));
      const ticker = normalizeTicker(input.ticker),
        market = await yahooMarket(ticker);
      await storeMarket(ticker, market);
      result = { ticker, sessions: market.points.length };
    } else if (path === "admin/ingest-announcements" && method === "POST") {
      admin(request);
      const input = z
        .object({
          ticker: z.string().max(32),
          document_id: z.string().max(100),
          headline: z.string().min(5).max(240),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          evidence_page: z.number().int().positive(),
          severity: z.number().min(0).max(40).default(10),
          magnitude: z.number().min(0).max(25).default(0),
        })
        .parse(await body(request));
      const ticker = normalizeTicker(input.ticker),
        d = await getDocument(input.document_id);
      if (
        !d ||
        d.ticker !== ticker ||
        !d.pages.some((p) => p.page === input.evidence_page)
      )
        throw new ApiError(
          422,
          "invalid_evidence",
          "Import the matching company document and supply an existing page first.",
        );
      const hash = await sha(`${d.hash}:${input.headline}`),
        category = classify(input.headline);
      const filing: Filing = {
        ...input,
        ticker,
        id: hash.slice(0, 24),
        date_precision: "Administrator-imported release date",
        category: category.category,
        summary: d.pages
          .find((p) => p.page === input.evidence_page)!
          .text.slice(0, 500),
        why: category.rationale,
        confidence: category.confidence,
        novelty: 5,
        evidence: 8,
        questions: ["What changed in this filing?"],
      };
      await run(
        "INSERT OR IGNORE INTO announcements(id,ticker,hash,document_id,date,payload) VALUES (?,?,?,?,?,?)",
        filing.id,
        ticker,
        hash,
        input.document_id,
        input.date,
        JSON.stringify(filing),
      );
      result = {
        filing,
        duplicate_detection: "Content hash with a unique database constraint",
      };
    } else if (path === "admin/ingest-document" && method === "POST") {
      admin(request);
      const input = z
        .object({
          ticker: z.string().max(32),
          url: z.string().url(),
          title: z.string().max(200),
        })
        .parse(await body(request));
      result = {
        id: await ingestPdf(
          normalizeTicker(input.ticker),
          input.url,
          input.title,
        ),
      };
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
    if (owner.startsWith("device:"))
      headers.set(
        "Set-Cookie",
        `finn_session=${owner.slice(7)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${url.protocol === "https:" ? "; Secure" : ""}`,
      );
    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Enter a valid NSE ticker"))
      return Response.json(
        { error: { code: "invalid_ticker", message: e.message } },
        { status: 422 },
      );
    if (e instanceof z.ZodError)
      return Response.json(
        {
          error: {
            code: "validation_error",
            message: e.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          },
        },
        { status: 422 },
      );
    if (e instanceof ApiError)
      return Response.json(
        { error: { code: e.code, message: e.message } },
        { status: e.status },
      );
    console.error(
      "FINN API failure",
      e instanceof Error ? e.message : "unknown",
    );
    return Response.json(
      {
        error: {
          code: "service_unavailable",
          message:
            "FINN could not complete this request. The source or database may be temporarily unavailable. Please retry.",
        },
      },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
