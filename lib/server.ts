import { fiscalPeriod } from "./periods";
import { sourceHref } from "./source-references";
import { ingestStructuredSource } from "./ingestion/structured-source";
import financialSources from "../data/financial-sources.json";
import {
  PDF_LAYOUT_VERSION,
  captureFinancialLayouts,
  extractPdfFinancials,
} from "./pdf-financials";
import { publicationMetadata } from "./pipeline-state";
import { financialLabelSupported, revenueContext } from "./financial-labels";
import { automatedEventSupported } from "./event-evidence";
import { contiguousEvidence } from "./event-analysis";
import { verifiedYahooDaily, type YahooResult } from "./yahoo-data";
import { canonicalResearchFilters } from "./research-filters";
import { marketFreshness, type MarketSync } from "./market-state";
import { exchangeDate } from "./market-sessions";
import { briefingPlan, monitoringCoverage } from "./briefing-query";
import { env } from "cloudflare:workers";
import seedData from "../data/seed.json";
import {
  defaultSettings,
  marketSummary,
  evaluateMarket,
  rank,
  inWindow,
  normalizeTicker,
  retrieve,
  type Point,
  type Settings,
  type Filing,
  type Metric,
} from "./domain";
import type { Company, Document, Research, RankedFiling } from "./types";
import { calculateFindings } from "./research-analysis";
import {
  locatePrimaryCandidates,
  rankCandidates,
  documentType,
  disclosureNotice,
  DISCOVERY_VERSION,
} from "./ingestion/discovery";
import announcementSources from "../data/announcement-sources.json";
import { inferHeaderPeriod } from "./financial-extraction";
import { sortPeriods } from "./periods";
import {
  filingByIdQuery,
  filingPageQuery,
  passageQuery,
  RETRIEVAL_VERSION,
  type FilingFilters,
} from "./query-plans";
const seed = seedData as unknown as {
  version: string;
  as_of: string;
  companies: Company[];
  portfolio: string[];
  documents: Document[];
  metrics: Metric[];
  events: Filing[];
  guidance: import("./domain").Guidance[];
  market: Record<
    string,
    { points: Point[]; retrieved_at: string; url: string }
  >;
};
import { db, all, one, run, sha, ApiError } from "../db/repository";
export { db, all, one, run, sha, ApiError } from "../db/repository";
import {
  providerStatus,
  synthesizeResearch,
  extractDocument,
} from "./ai/service";
import { PROMPT_VERSION, AiFailure } from "./ai/gemini";
import {
  persistFiling,
  seedGuidance,
  guidanceRows,
  evaluateAlerts,
  trackSync,
  persistComparisons,
} from "./workflows";
export function chunkPage(text: string, size = 2000) {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const result: string[] = [];
  for (let start = 0; start < clean.length; start += size - 200)
    result.push(clean.slice(start, start + size));
  return result;
}
function insertMany(
  table: string,
  columns: string[],
  rows: (string | number | null)[][],
  replace = false,
) {
  const statements: D1PreparedStatement[] = [],
    count = Math.floor(90 / columns.length);
  for (let i = 0; i < rows.length; i += count) {
    const group = rows.slice(i, i + count);
    statements.push(
      db()
        .prepare(
          `INSERT OR ${replace ? "REPLACE" : "IGNORE"} INTO ${table} (${columns.join(",")}) VALUES ${group.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}`,
        )
        .bind(...group.flat()),
    );
  }
  return statements;
}
async function annotateSeed() {
  await run(
    "UPDATE financial_metrics SET fiscal_year=CAST(substr(period,instr(period,'FY')+2) AS INTEGER),fiscal_quarter=CASE WHEN period LIKE 'Q_ FY%' THEN CAST(substr(period,2,1) AS INTEGER) END WHERE fiscal_year IS NULL AND (period GLOB 'FY[0-9][0-9][0-9][0-9]' OR period GLOB 'Q[1-4] FY[0-9][0-9][0-9][0-9]')",
  );
  for (const d of seed.documents)
    await run(
      "UPDATE documents SET publisher=?,extraction_status=?,total_pages=?,indexed_pages=?,period_status='reviewed' WHERE id=? AND (publisher IS NULL OR period_status<>'reviewed')",
      new URL(d.url).hostname,
      (d as Document & { total_pages?: number }).total_pages! > d.pages.length
        ? "partial"
        : "complete",
      (d as Document & { total_pages?: number }).total_pages ?? d.pages.length,
      d.pages.length,
      d.id,
    );
}
async function reconcileStagingAudit() {
  await reconcileDocumentKinds();
  await reconcileEventEvidence();
  if (
    !(await one("SELECT value FROM meta WHERE key='source-context-review-v1'"))
  ) {
    const affected = await all<{
      id: string;
      document_id: string;
      page: number;
      evidence_text: string;
    }>(
      "SELECT m.id,m.document_id,m.page,m.evidence_text FROM financial_metrics m WHERE m.name='Revenue' AND m.verification_status='unverified' AND EXISTS (SELECT 1 FROM extraction_audit a WHERE a.document_id=m.document_id AND a.method='definition_review_v4' AND instr(a.reason,m.id)>0)",
    );
    for (const m of affected) {
      const doc = await getDocument(m.document_id),
        page = doc?.pages.find((p) => p.page === m.page);
      const context = page
        ? revenueContext(page.text, m.evidence_text)
        : undefined;
      if (!context) continue;
      await db().batch([
        db()
          .prepare(
            "UPDATE financial_metrics SET evidence_text=?,verification_status='source_checked',extraction_method='source_context_review_v1' WHERE id=?",
          )
          .bind(context, m.id),
        db()
          .prepare(
            "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            m.document_id,
            "source_context_review_v1",
            "restored",
            JSON.stringify({
              metric_id: m.id,
              original_excerpt: m.evidence_text,
              note: "Exact original quote expanded to adjacent revenue heading without crossing another financial measure.",
            }),
            new Date().toISOString(),
          ),
      ]);
    }
    await run(
      "INSERT OR IGNORE INTO meta(key,value) VALUES ('source-context-review-v1','complete')",
    );
  }
  if (await one("SELECT value FROM meta WHERE key='staging-audit-v1'")) return;
  const rows = await all<{ id: string; payload: string }>(
    "SELECT id,payload FROM announcements",
  );
  for (const row of rows) {
    const f = JSON.parse(row.payload);
    const updated = { ...f, ...publicationMetadata(f) };
    await run(
      "UPDATE announcements SET published_at=?,payload=? WHERE id=?",
      updated.published_at,
      JSON.stringify(updated),
      row.id,
    );
  }
  await run(
    "UPDATE document_jobs SET status='manual_required',extraction_status='legacy_requires_review',error='Prior completion did not establish verified financial output; source document retained.' WHERE status='complete' AND type IN ('results','annual_report','presentation','transcript') AND document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM financial_metrics m WHERE m.document_id=document_jobs.document_id AND m.verification_status<>'unverified') AND NOT EXISTS (SELECT 1 FROM guidance_statements g WHERE g.document_id=document_jobs.document_id AND g.verification_status<>'unverified')",
  );
  await run(
    "INSERT OR IGNORE INTO meta(key,value) VALUES ('staging-audit-v1','complete')",
  );
}
async function reconcileDocumentKinds() {
  if (
    await one(
      "SELECT value FROM meta WHERE key='document-notice-type-review-v2'",
    )
  )
    return;
  const docs = await all<{ id: string; title: string; type: string }>(
    "SELECT id,title,type FROM documents WHERE mode='live' AND type IN ('results','transcript')",
  );
  for (const d of docs.filter(
    (d) =>
      disclosureNotice(d.title) && documentType(d.title) === "announcement",
  )) {
    await db().batch([
      db()
        .prepare("UPDATE documents SET type='announcement' WHERE id=?")
        .bind(d.id),
      db()
        .prepare(
          "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          d.id,
          "document_notice_type_review_v2",
          "metadata_corrected",
          JSON.stringify({
            previous_type: d.type,
            type: "announcement",
            reason:
              "Call invitations, recording notices and newspaper-publication disclosures are not the original results or transcript itself. Original document and extraction history retained.",
          }),
          new Date().toISOString(),
        ),
    ]);
  }
  for (const table of ["document_jobs", "discovery_candidates"] as const) {
    const candidates = await all<{ id: string; title: string }>(
      `SELECT id,title FROM ${table} WHERE type IN ('results','transcript')`,
    );
    for (const c of candidates.filter(
      (c) =>
        disclosureNotice(c.title) && documentType(c.title) === "announcement",
    ))
      await run(`UPDATE ${table} SET type='announcement' WHERE id=?`, c.id);
  }
  await run(
    "INSERT OR IGNORE INTO meta(key,value) VALUES ('document-notice-type-review-v2','complete')",
  );
}
async function reconcileEventEvidence() {
  if (await one("SELECT value FROM meta WHERE key='event-evidence-review-v2'"))
    return;
  const rows = await all<{ id: string; document_id: string; payload: string }>(
    "SELECT id,document_id,payload FROM announcements WHERE json_extract(payload,'$.event_quote') IS NOT NULL AND json_extract(payload,'$.canonical_event_id') IS NULL AND verification_status<>'review_required'",
  );
  for (const row of rows) {
    const f = JSON.parse(row.payload) as Filing;
    const doc = await getDocument(row.document_id);
    const page = doc?.pages.find((p) => p.page === f.evidence_page);
    const quote = page ? contiguousEvidence(page.text, f.event_quote!) : null;
    const automatic =
      !!f.source_provider && f.source_provider !== "verified_admin";
    const reason = !quote
      ? "The stored excerpt cannot be established as one passage on the cited page."
      : automatic && !automatedEventSupported(f.category, quote, f.headline)
        ? "The passage does not establish a new event of this category; financial-note references require review."
        : null;
    if (!reason && quote === f.event_quote) continue;
    const updated = {
      ...f,
      ...(quote ? { event_quote: quote } : {}),
      ...(reason ? { review_required: true, review_reason: reason } : {}),
    };
    await db().batch([
      db()
        .prepare(
          "UPDATE announcements SET payload=?,verification_status=CASE WHEN ?=1 THEN 'review_required' ELSE verification_status END WHERE id=?",
        )
        .bind(JSON.stringify(updated), reason ? 1 : 0, row.id),
      db()
        .prepare(
          "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          row.document_id,
          "event_evidence_review_v1",
          reason ? "review_required" : "excerpt_expanded",
          JSON.stringify({
            announcement_id: row.id,
            original_excerpt: f.event_quote,
            corrected_excerpt: quote,
            reason,
          }),
          new Date().toISOString(),
        ),
    ]);
  }
  await run(
    "INSERT OR IGNORE INTO meta(key,value) VALUES ('event-evidence-review-v2','complete')",
  );
}
let initialization: Promise<void> | null = null;
export async function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    if (
      !(await one(
        "SELECT value FROM meta WHERE key='metric-definition-check-v3'",
      ))
    ) {
      const affected = await all<{ id: string; document_id: string }>(
        "SELECT id,document_id FROM financial_metrics WHERE extraction_method='gemini' AND name='EBITDA' AND lower(evidence_text) NOT LIKE '%ebitda%' AND verification_status<>'unverified'",
      );
      for (const m of affected)
        await db().batch([
          db()
            .prepare(
              "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              m.document_id,
              "definition_review_v3",
              "superseded",
              `Metric ${m.id}: EBITDA label not explicit in the accepted excerpt; excluded pending review.`,
              new Date().toISOString(),
            ),
          db()
            .prepare(
              "UPDATE financial_metrics SET verification_status='unverified' WHERE id=?",
            )
            .bind(m.id),
        ]);
      await run(
        "INSERT OR IGNORE INTO meta(key,value) VALUES ('metric-definition-check-v3','complete')",
      );
    }
    if (
      !(await one(
        "SELECT value FROM meta WHERE key='metric-definition-check-v4'",
      ))
    ) {
      const candidates = await all<{
        id: string;
        document_id: string;
        name: string;
        evidence_text: string;
      }>(
        "SELECT id,document_id,name,evidence_text FROM financial_metrics WHERE extraction_method='gemini' AND verification_status<>'unverified' AND name IN ('Revenue','Operating margin','Borrowings')",
      );
      for (const m of candidates.filter(
        (m) => !financialLabelSupported(m.name, m.evidence_text),
      ))
        await db().batch([
          db()
            .prepare(
              "INSERT INTO extraction_audit(id,document_id,method,status,reason,created_at) VALUES (?,?,?,?,?,?)",
            )
            .bind(
              crypto.randomUUID(),
              m.document_id,
              "definition_review_v4",
              "superseded",
              `Metric ${m.id}: ${m.name} is not established by its accepted excerpt; retained unverified.`,
              new Date().toISOString(),
            ),
          db()
            .prepare(
              "UPDATE financial_metrics SET verification_status='unverified' WHERE id=?",
            )
            .bind(m.id),
        ]);
      await run(
        "INSERT OR IGNORE INTO meta(key,value) VALUES ('metric-definition-check-v4','complete')",
      );
    }
    if (await one("SELECT value FROM meta WHERE key = ?", seed.version)) {
      await reconcileStagingAudit();
      await annotateSeed();
      await seedGuidance(seed.guidance);
      return;
    }
    const statements = [
      ...insertMany(
        "companies",
        ["ticker", "name", "sector", "validation", "updated_at"],
        seed.companies.map((c) => [
          c.ticker,
          c.name,
          c.sector,
          c.validation,
          c.updated_at ?? "2026-10-30",
        ]),
      ),
      ...insertMany(
        "documents",
        [
          "id",
          "ticker",
          "title",
          "type",
          "period",
          "url",
          "published_at",
          "retrieved_at",
          "hash",
          "mode",
        ],
        seed.documents.map((d) => [
          d.id,
          d.ticker,
          d.title,
          d.type,
          d.period,
          d.url,
          d.published_at,
          d.retrieved_at,
          d.hash,
          d.mode,
        ]),
      ),
      ...insertMany(
        "document_chunks",
        ["id", "document_id", "ticker", "page", "text"],
        seed.documents.flatMap((d) =>
          d.pages.flatMap((p) =>
            chunkPage(p.text).map((t, i) => [
              `${d.id}:${p.page}:${i}`,
              d.id,
              d.ticker,
              p.page,
              t,
            ]),
          ),
        ),
      ),
      ...insertMany(
        "daily_prices",
        [
          "ticker",
          "date",
          "close",
          "adjusted_close",
          "volume",
          "source",
          "retrieved_at",
          "mode",
        ],
        Object.entries(seed.market).flatMap(([ticker, m]) =>
          m.points.map((p) => [
            ticker,
            p.date,
            p.close,
            p.adjusted_close,
            p.volume,
            m.url,
            m.retrieved_at,
            "historical",
          ]),
        ),
      ),
      ...insertMany(
        "financial_metrics",
        [
          "id",
          "ticker",
          "name",
          "value",
          "period",
          "unit",
          "basis",
          "document_id",
          "page",
          "currency",
          "scale",
          "fiscal_year",
          "fiscal_quarter",
          "evidence_text",
          "updated_at",
        ],
        seed.metrics.map((m) => [
          m.id,
          m.ticker,
          m.name,
          m.value,
          m.period,
          m.unit,
          m.basis,
          m.document_id,
          m.page,
          m.unit.startsWith("INR") ? "INR" : null,
          m.unit.includes("crore") ? "crore" : null,
          Number(m.period.match(/FY(\d{4})/)?.[1]) || null,
          Number(m.period.match(/^Q([1-4])/)?.[1]) || null,
          seed.documents
            .find((d) => d.id === m.document_id)
            ?.pages.find((p) => p.page === m.page)?.text ?? "",
          seed.documents.find((d) => d.id === m.document_id)?.retrieved_at ??
            "",
        ]),
      ),
    ];
    for (const f of seed.events)
      statements.push(
        db()
          .prepare(
            "INSERT OR IGNORE INTO announcements (id,ticker,hash,document_id,date,payload) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            f.id,
            f.ticker,
            await sha(`${f.document_id}:${f.headline}`),
            f.document_id,
            f.date,
            JSON.stringify(f),
          ),
      );
    for (let i = 0; i < statements.length; i += 35)
      await db().batch(statements.slice(i, i + 35));
    for (const filing of seed.events)
      await persistFiling(filing, "historical", "human_reviewed");
    await reconcileStagingAudit();
    await seedGuidance(seed.guidance);
    await annotateSeed();
    await run(
      "INSERT OR IGNORE INTO meta (key,value) VALUES (?,?)",
      seed.version,
      new Date().toISOString(),
    );
  })().catch((e) => {
    initialization = null;
    throw e;
  });
  return initialization;
}
export async function ownerFor(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.match(
      /(?:^|;\s*)finn_session=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:;|$)/i,
    )?.[1];
  return `device:${cookie ?? crypto.randomUUID()}`;
}
export async function ensureOwner(owner: string) {
  const now = new Date().toISOString();
  await db().batch([
    db()
      .prepare("INSERT OR IGNORE INTO owners(id,created_at) VALUES (?,?)")
      .bind(owner, now),
    ...seed.portfolio.map((t) =>
      db()
        .prepare(
          "INSERT OR IGNORE INTO portfolio_companies(owner,ticker,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM owners WHERE id=? AND initialized_at IS NULL)",
        )
        .bind(owner, t, now, owner),
    ),
    db()
      .prepare(
        "UPDATE owners SET initialized_at=? WHERE id=? AND initialized_at IS NULL",
      )
      .bind(now, owner),
  ]);
}
export async function getSettings(owner: string): Promise<Settings> {
  const row = await one<{ settings: string }>(
    "SELECT settings FROM alert_preferences WHERE owner = ?",
    owner,
  );
  return row ? JSON.parse(row.settings) : structuredClone(defaultSettings);
}
// Raw-only observations remain distinct; a verified adjusted bar supersedes the same raw session.
const observedPricesByMode = `(SELECT ticker,date,close,adjusted_close,volume,mode,open,high,low,provider,completion_status FROM daily_prices UNION ALL SELECT r.ticker,r.date,r.close,NULL AS adjusted_close,r.volume,r.mode,r.open,r.high,r.low,r.provider,r.completion_status FROM unadjusted_daily_prices r WHERE NOT EXISTS (SELECT 1 FROM daily_prices a WHERE a.ticker=r.ticker AND a.date=r.date AND a.mode=r.mode))`;
export async function getPoints(ticker: string, mode = "live") {
  return all<Point>(
    "SELECT date,close,adjusted_close,volume,open,high,low,provider,completion_status FROM " +
      observedPricesByMode +
      " WHERE ticker=? AND mode=? AND date>=coalesce((SELECT json_extract(value,'$.date') FROM meta WHERE key='listing:'||?), '0000') ORDER BY date",
    ticker,
    mode,
    ticker,
  );
}
export async function portfolioFor(owner: string, mode = "live") {
  const [companies, settings, points, counts] = await Promise.all([
    all<Company>(
      "SELECT c.* FROM companies c JOIN portfolio_companies p ON p.ticker=c.ticker WHERE p.owner=? ORDER BY c.name",
      owner,
    ),
    getSettings(owner),
    all<Point & { ticker: string }>(
      "SELECT d.ticker,d.date,d.close,d.adjusted_close,d.volume FROM " +
        observedPricesByMode +
        " d JOIN portfolio_companies p ON p.ticker=d.ticker WHERE p.owner=? AND d.mode=? AND d.date>=coalesce((SELECT json_extract(value,'$.date') FROM meta WHERE key='listing:'||d.ticker),'0000') ORDER BY d.date",
      owner,
      mode,
    ),
    all<{ ticker: string; n: number }>(
      "SELECT a.ticker,count(*) n FROM announcements a JOIN portfolio_companies p ON p.ticker=a.ticker WHERE p.owner=? AND a.ingestion_mode=? AND json_extract(a.payload,'$.canonical_event_id') IS NULL AND a.verification_status<>'review_required' AND a.severity>=20 GROUP BY a.ticker",
      owner,
      mode,
    ),
  ]);
  const marketSync =
    mode === "live"
      ? await all<MarketSync & { ticker: string }>(
          "SELECT * FROM source_sync WHERE provider='market'",
        )
      : [];
  return companies.map((c) => ({
    ...c,
    ...marketSummary(
      points.filter((p) => p.ticker === c.ticker),
      settings.volume_lookback,
    ),
    events: counts.find((x) => x.ticker === c.ticker)?.n ?? 0,
    prior_sessions: Math.max(
      0,
      points.filter((p) => p.ticker === c.ticker).length - 1,
    ),
    relative_volume_status:
      points.filter((p) => p.ticker === c.ticker).length <=
      settings.volume_lookback
        ? "Insufficient prior sessions"
        : "Available",
    ...(mode === "live"
      ? {
          market_freshness: marketFreshness(
            points.filter((p) => p.ticker === c.ticker).at(-1)?.date ?? null,
            marketSync.find((s) => s.ticker === c.ticker),
          ),
        }
      : {}),
  }));
}
export async function getFilings(
  filters: {
    ticker?: string;
    start?: string;
    end?: string;
    category?: string;
    mode?: string;
    priority?: number;
  } = {},
) {
  filters = { ...filters, mode: filters.mode ?? "live" };
  const clauses: string[] = [
      "json_extract(payload,'$.canonical_event_id') IS NULL AND verification_status<>'review_required'",
    ],
    values: (string | number)[] = [];
  for (const [key, column, op] of [
    ["ticker", "ticker", "="],
    ["start", "date", ">="],
    ["end", "date", "<="],
    ["category", "category", "="],
    ["mode", "ingestion_mode", "="],
    ["priority", "materiality_score", ">="],
  ] as const) {
    if (filters[key] !== undefined) {
      clauses.push(`${column} ${op} ?`);
      values.push(filters[key]!);
    }
  }
  const rows = await all<{ payload: string }>(
    `SELECT payload FROM announcements ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY date DESC LIMIT 500`,
    ...values,
  );
  try {
    return rows.map((f) => JSON.parse(f.payload) as Filing);
  } catch {
    throw new ApiError(
      503,
      "invalid_stored_filing",
      "A stored filing is malformed. Other data is preserved.",
    );
  }
}
export async function getFilingById(id: string) {
  const row = await one<{ payload: string }>(filingByIdQuery, id);
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as Filing;
  } catch {
    throw new ApiError(
      503,
      "invalid_stored_filing",
      "The stored filing needs review; its source has been preserved.",
    );
  }
}
export async function getFilingPage(filters: FilingFilters = {}) {
  let plan;
  try {
    plan = filingPageQuery(filters);
  } catch {
    throw new ApiError(
      422,
      "invalid_cursor",
      "The announcement cursor is invalid.",
    );
  }
  const rows = await all<{ id: string; date: string; payload: string }>(
    plan.sql,
    ...plan.values,
  );
  const more = rows.length > plan.limit,
    page = rows.slice(0, plan.limit),
    last = page.at(-1);
  return {
    announcements: page.map((r) => JSON.parse(r.payload) as Filing),
    next_cursor:
      more && last ? btoa(JSON.stringify([last.date, last.id])) : null,
  };
}
export async function getDocument(id: string) {
  const doc = await one<Omit<Document, "pages">>(
    "SELECT * FROM documents WHERE id=?",
    id,
  );
  if (!doc) return null;
  const chunks = await all<{ page: number; text: string }>(
    "SELECT page,text FROM document_chunks WHERE document_id=? ORDER BY page,CAST(substr(id,length(document_id)+length(CAST(page AS TEXT))+3) AS INTEGER)",
    id,
  );
  const pages = new Map<number, string>();
  for (const chunk of chunks) {
    const previous = pages.get(chunk.page);
    pages.set(
      chunk.page,
      previous === undefined
        ? chunk.text
        : previous +
            (previous.endsWith(chunk.text.slice(0, 200))
              ? chunk.text.slice(200)
              : chunk.text),
    );
  }
  return { ...doc, pages: [...pages].map(([page, text]) => ({ page, text })) };
}
export async function eventDetail(
  f: Filing,
  settings: Settings,
): Promise<RankedFiling> {
  const [d, c] = await Promise.all([
    getDocument(f.document_id),
    one<{ name: string }>(
      "SELECT name FROM companies WHERE ticker=?",
      f.ticker,
    ),
  ]);
  const metrics = await all<Metric>(
    "SELECT m.*,d.published_at FROM financial_metrics m JOIN documents d ON d.id=m.document_id WHERE m.ticker=? AND verification_status<>'unverified'",
    f.ticker,
  );
  await persistComparisons(f.ticker, metrics);
  const sourceDocs = await all<{ id: string; url: string }>(
    "SELECT id,url FROM documents WHERE ticker=?",
    f.ticker,
  );
  const supplements =
    f.id === "infy-fy25-results"
      ? [{ id: "infy-call-q3", page: 7 }]
      : f.id === "hcl-fy25-results"
        ? [{ id: "hcl-results", page: 4 }]
        : [];
  const supporting_sources = await Promise.all(
    supplements.map(async (s) => {
      const source = await getDocument(s.id);
      return {
        document_id: s.id,
        page: s.page,
        url: source?.url ?? "",
        title: source?.title ?? "Unavailable",
        period: source?.period ?? "",
        text:
          source?.pages
            .filter((p) => p.page === s.page)
            .map((p) => p.text)
            .join("\n") ?? "",
      };
    }),
  );
  return {
    ...rank(f, settings),
    source_url: d?.url ?? "",
    company_name: c?.name ?? f.ticker,
    evidence_text:
      d?.pages
        .filter((p) => p.page === f.evidence_page)
        .map((p) => p.text)
        .join("\n") ?? "Source text unavailable",
    metrics,
    supporting_sources,
    metric_source_urls: Object.fromEntries(
      sourceDocs.map((s) => [s.id, s.url]),
    ),
  };
}
export async function digest(owner: string, params: URLSearchParams) {
  const mode = params.get("mode") === "historical" ? "historical" : "live";
  const end =
    params.get("end") ??
    (mode === "historical" ? seed.as_of : exchangeDate(new Date()));
  const days = Math.min(3650, Math.max(1, Number(params.get("days") ?? 1)));
  const rolling = mode === "live" && !params.has("start") && !params.has("end");
  const since = rolling
    ? new Date(Date.now() - days * 86400000).toISOString()
    : undefined;
  const start =
    params.get("start") ??
    (since ? exchangeDate(new Date(since)) : undefined) ??
    new Date(new Date(end + "T00:00:00Z").getTime() - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  const [portfolio, settings] = await Promise.all([
    portfolioFor(owner, mode),
    getSettings(owner),
  ]);
  const filters = {
    owner,
    mode,
    start,
    end,
    ticker: params.get("ticker") ?? undefined,
    category: params.get("category") ?? undefined,
    priority: params.has("priority")
      ? Number(params.get("priority"))
      : undefined,
    limit: Number(params.get("limit") ?? 30),
    cursor: params.get("cursor") ?? undefined,
    routine_cursor: params.get("routine_cursor") ?? undefined,
    since,
    until: rolling ? new Date().toISOString() : undefined,
  };
  let important, low;
  try {
    important = briefingPlan(filters, settings);
    low = briefingPlan(filters, settings, "routine");
  } catch {
    throw new ApiError(
      422,
      "invalid_cursor",
      "The briefing cursor is invalid.",
    );
  }
  const [totals, eventRows, routineRows, sync] = await Promise.all([
    one<{ total: number; important_count: number; event_companies: number }>(
      important.count.sql,
      ...important.count.values,
    ),
    all<{ id: string; date: string; payload: string; score: number }>(
      important.page.sql,
      ...important.page.values,
    ),
    all<{ id: string; date: string; payload: string; score: number }>(
      low.page.sql,
      ...low.page.values,
    ),
    all<{
      ticker: string;
      provider: string;
      status: string;
      last_success: string | null;
      last_attempt: string | null;
    }>("SELECT * FROM source_sync"),
  ]);
  const coverage = monitoringCoverage(
    portfolio.map((c) => c.ticker),
    announcementSources,
    sync,
    start,
    end,
  );
  const enrich = async (rows: typeof eventRows) =>
    Promise.all(
      rows
        .slice(0, important.limit)
        .map((r) => eventDetail(JSON.parse(r.payload), settings)),
    );
  const [surfaced, routine] = await Promise.all([
    enrich(eventRows),
    enrich(routineRows),
  ]);
  const next = (rows: typeof eventRows) =>
    rows.length > important.limit
      ? btoa(
          JSON.stringify([
            rows[important.limit - 1].score,
            rows[important.limit - 1].date,
            rows[important.limit - 1].id,
          ]),
        )
      : null;
  const movements = (
    await Promise.all(
      portfolio.map(async (c) => {
        if (params.get("ticker") && c.ticker !== params.get("ticker"))
          return [];
        const points = await getPoints(c.ticker, mode);
        // Evaluate each observed session in the window against only its own prior history.
        return points.flatMap((p, i) =>
          inWindow(p.date, start, end)
            ? evaluateMarket(c.ticker, points.slice(0, i + 1), settings)
            : [],
        );
      }),
    )
  ).flat();
  if (!filters.cursor && !filters.routine_cursor)
    await evaluateAlerts(owner, mode, start, end);
  return {
    mode,
    start,
    end,
    events: surfaced,
    routine,
    market_alerts: movements,
    total: totals?.total ?? 0,
    important_count: totals?.important_count ?? 0,
    routine_count: (totals?.total ?? 0) - (totals?.important_count ?? 0),
    companies_with_events: totals?.event_companies ?? 0,
    next_cursor: next(eventRows),
    next_routine_cursor: next(routineRows),
    ...coverage,
    companies: portfolio.length,
    covered_companies: coverage.successfully_checked_companies,
    unavailable_companies: portfolio.filter((c) => !c.date).length,
    window_precision: rolling
      ? "Rolling time window for timestamped filings; date-only disclosures use the intersecting exchange calendar dates."
      : "Exchange calendar dates",
    source_note:
      mode === "historical"
        ? "Historical replay. Cached official company disclosures; limited filing coverage, not a complete exchange feed. Dates are original event dates. EOD prices are Yahoo Finance observations."
        : "Live mode never substitutes the historical snapshot. Refresh market data to retrieve recent sessions; bounded announcement checks run on opening for accessible original sources. Coverage gaps remain explicit.",
  };
}
export async function guidanceFor(ticker?: string, mode = "live") {
  const rows = await guidanceRows(ticker);
  if (mode === "historical") return rows;
  return rows.filter(
    (g) =>
      !rows.some(
        (other) =>
          other.ticker === g.ticker &&
          other.metric === g.metric &&
          (fiscalPeriod(other.period)?.ordinal ?? 0) >
            (fiscalPeriod(g.period)?.ordinal ?? 0),
      ),
  );
}
export async function research(
  ticker: string,
  question: string,
  filters: { period?: string; type?: string } = {},
  options: { prepared?: boolean; onSynthesis?: () => Promise<void> } = {},
): Promise<Research> {
  const docs = await all<Omit<Document, "pages">>(
    "SELECT * FROM documents WHERE ticker=? ORDER BY published_at DESC",
    ticker,
  );
  const missing: string[] = [];
  const discoveryState = await one<{ last_attempt: string }>(
    "SELECT last_attempt FROM source_sync WHERE provider='document_discovery' AND ticker=?",
    ticker,
  );
  const stale =
    !discoveryState?.last_attempt ||
    Date.parse(discoveryState.last_attempt) < Date.now() - 86400000;
  if (
    !options.prepared &&
    (!docs.length ||
      (!!filters.type && !docs.some((d) => d.type === filters.type)) ||
      (stale &&
        !(filters.period && docs.some((d) => d.period === filters.period))))
  ) {
    const discovery = await discoverDocuments(ticker, { question, ...filters });
    missing.push(...discovery.limitations);
    docs.splice(
      0,
      docs.length,
      ...(await all<Omit<Document, "pages">>(
        "SELECT * FROM documents WHERE ticker=?",
        ticker,
      )),
    );
  }
  {
    const count = await one<{ n: number }>(
      "SELECT count(*) n FROM financial_metrics WHERE ticker=? AND verification_status<>'unverified'",
      ticker,
    );
    if (!options.prepared && !count?.n)
      for (const d of docs.slice(0, 2))
        await extractDocument(ticker, d.id).catch(() =>
          missing.push(
            "Financial extraction was unavailable or rejected; source excerpts remain available.",
          ),
        );
  }
  for (const d of docs.filter(
    (d) => d.mode === "live" && d.period === "Period not verified",
  )) {
    const complete = await getDocument(d.id),
      period = complete ? inferHeaderPeriod(complete.pages) : null;
    if (period) {
      await run(
        "UPDATE documents SET period=?,period_status='source_header' WHERE id=?",
        period,
        d.id,
      );
      d.period = period;
    }
  }
  const requestedPeriod =
    filters.period ??
    question.match(/(?:Q[1-4]\s+)?FY\d{4}/i)?.[0]?.toUpperCase() ??
    (!filters.period
      ? sortPeriods(
          docs
            .filter(
              (d) =>
                d.period_status !== "unverified" &&
                (!filters.type || d.type === filters.type),
            )
            .map((d) => d.period),
        ).find((p) =>
          /annual|full.year/i.test(question)
            ? p.startsWith("FY")
            : p.startsWith("Q"),
        )
      : undefined);
  if (requestedPeriod) filters = { ...filters, period: requestedPeriod };
  const metrics = await all<Metric>(
    "SELECT m.*,d.published_at FROM financial_metrics m JOIN documents d ON d.id=m.document_id WHERE m.ticker=? AND verification_status<>'unverified'",
    ticker,
  );
  await persistComparisons(ticker, metrics);
  const version = String(
    (
      await one<{ revision: number }>(
        "SELECT revision FROM company_versions WHERE ticker=?",
        ticker,
      )
    )?.revision ?? 0,
  );
  const config = providerStatus();
  const key = await sha(
    JSON.stringify({
      ticker,
      version,
      question: question.trim().toLowerCase(),
      filters: canonicalResearchFilters(filters),
      retrieval: RETRIEVAL_VERSION,
      enabled: config.enabled,
      model: config.model,
      reasoning: config.reasoning_model,
      prompt: PROMPT_VERSION,
    }),
  );
  const cached = await one<{ payload: string }>(
    "SELECT payload FROM analysis_cache WHERE key=? AND expires_at>?",
    key,
    new Date().toISOString(),
  );
  if (cached) return { ...JSON.parse(cached.payload), cached: true };
  // FTS returns full records directly; a hit never depends on an in-memory library slice.
  let candidates: {
    id: string;
    ticker: string;
    text: string;
    page: number;
    document_id: string;
    title: string;
    url: string;
    period: string;
    type: string;
    source_format?: string;
  }[] = [];
  try {
    const plan = passageQuery(ticker, question, filters);
    candidates = await all(plan.sql, ...plan.values);
  } catch {
    /* Indexed SQL lexical fallback below. */
  }
  if (!candidates.length) {
    const plan = passageQuery(ticker, question, filters, false);
    candidates = await all(plan.sql, ...plan.values);
  }
  const selected = retrieve(
    candidates,
    ticker,
    question,
    { type: filters.type },
    8,
  ).filter(
    (p, i, a) =>
      a.findIndex(
        (x) =>
          x.document_id === p.document_id &&
          x.page === p.page &&
          x.text === p.text,
      ) === i,
  );
  const refs = selected.map((s, i) => ({
    id: `S${i + 1}`,
    document_id: s.document_id,
    page: s.page,
    title: s.title,
    url: sourceHref(s.url, s.page, s.source_format),
    source_format: s.source_format,
    text: s.text,
    period: s.period,
  }));
  const output: Research = {
    ticker,
    question,
    summary: selected.length
      ? "Relevant primary-source passages are available below. Read them with the cited reporting periods and accounting basis."
      : "Insufficient source evidence to answer this question. No company-specific conclusion can be established from the available documents.",
    key_findings: [],
    metrics,
    source_references: refs,
    limitations: [
      ...missing,
      !docs.length
        ? "No primary documents are indexed for this ticker. Source failures are shown separately."
        : docs.some((d) => d.mode === "live")
          ? "Newly retrieved documents may have unverified fiscal-period labels. Their recency and completeness are not guaranteed."
          : "Historical research library; documents do not represent the latest reporting period.",
      "Retrieval finds matching passages. It does not establish complete coverage of every disclosure.",
    ],
    confidence: selected.length >= 3 ? "medium" : "low",
    engine: "Source retrieval · no LLM credentials required",
  };
  // Offline mode is intentionally extractive: retrieved text cannot act as executable instructions.
  output.key_findings = refs.map((s) => ({
    text: s.text,
    source_ids: [s.id],
    excerpt: true,
  }));
  const calculated = calculateFindings(
    ticker,
    question,
    filters.type
      ? metrics.filter((m) =>
          docs.some((d) => d.id === m.document_id && d.type === filters.type),
        )
      : metrics,
    await guidanceRows(ticker),
    requestedPeriod,
  );
  if (calculated.length) {
    const findings: Research["key_findings"] = [];
    for (const finding of calculated) {
      const ids: string[] = [];
      for (const location of finding.sources) {
        let ref = refs.find(
          (r) =>
            r.document_id === location.document_id && r.page === location.page,
        );
        if (!ref) {
          const document = await getDocument(location.document_id);
          const text = document?.pages
            .filter((p) => p.page === location.page)
            .map((p) => p.text)
            .join("\n");
          if (!document || !text) continue;
          ref = {
            id: `S${refs.length + 1}`,
            document_id: document.id,
            page: location.page,
            title: document.title,
            url: sourceHref(
              document.url,
              location.page,
              document.source_format,
            ),
            source_format: document.source_format,
            text,
            period: document.period,
          };
          refs.push(ref);
        }
        ids.push(ref.id);
      }
      if (ids.length === finding.sources.length)
        findings.push({
          text: finding.text,
          source_ids: [...new Set(ids)],
          excerpt: false,
          evidence_type: finding.evidence_type ?? "calculated",
          verification: "deterministic",
        });
    }
    if (findings.length) {
      output.key_findings = [...findings, ...output.key_findings.slice(0, 3)];
      output.summary = `${findings[0].text} [${findings[0].source_ids.join(", ")}]`;
      output.engine = "Deterministic calculation + source retrieval";
    }
  }
  output.ai_status = config.enabled ? "insufficient_evidence" : "offline";
  if (config.enabled && refs.length) {
    try {
      await options.onSynthesis?.();
      const answer = await synthesizeResearch(
        ticker,
        question,
        refs.map((r) => ({ ...r, ticker })),
        metrics,
        calculated.map((f) => f.text),
      );
      const mapped = (f: typeof answer.concise_summary) => ({
        text: f.claim,
        source_ids: f.supporting_source_ids,
        evidence_excerpt: f.evidence_excerpt,
        uncertainty_note: f.uncertainty_note,
        evidence_type: f.evidence_type,
        verification: "source_checked",
      });
      output.summary = answer.concise_summary.claim;
      output.key_findings = [
        ...output.key_findings.filter(
          (f) => f.verification === "deterministic",
        ),
        mapped(answer.concise_summary),
        ...answer.findings.map(mapped),
      ];
      output.management_commentary = answer.management_commentary.map(mapped);
      output.risks = answer.risks.map(mapped);
      output.positive_factors = answer.positive_factors.map(mapped);
      output.limitations.push(
        ...answer.limitations,
        "Automated excerpt/number checks do not prove every semantic inference. Inspect the primary passages.",
      );
      output.confidence_basis = answer.confidence_basis;
      output.usage = answer.usage;
      output.engine = `Gemini · ${config.model} · evidence checked`;
      output.model_used = answer.model_used;
      output.ai_status = "success";
    } catch (e) {
      output.ai_status = e instanceof AiFailure ? e.code : "validation_failed";
      output.limitations.push(
        `Gemini unavailable or response rejected (${output.ai_status}). Showing deterministic calculations and source excerpts.`,
      );
    }
  } else if (!config.enabled)
    output.limitations.push(
      "Extractive/offline mode. Configure server-side GEMINI_API_KEY, AI_ENABLED and GEMINI_MODEL_FAST to enable Gemini.",
    );
  output.generated_at = new Date().toISOString();
  // Do not cache transient provider failures as successful offline answers.
  if (!config.enabled || output.ai_status === "success" || !refs.length)
    await run(
      "INSERT INTO analysis_cache(key,payload,created_at,expires_at,ticker,document_version,model,prompt_version) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at",
      key,
      JSON.stringify(output),
      output.generated_at,
      new Date(Date.now() + 86400000).toISOString(),
      ticker,
      version,
      config.model ?? "offline",
      PROMPT_VERSION,
    );
  return output;
}
export async function resolveCompany(raw: string) {
  const ticker = normalizeTicker(raw);
  const cached = await one<Company>(
    "SELECT * FROM companies WHERE ticker=?",
    ticker,
  );
  if (cached) return cached;
  const chart = await yahooMarket(ticker);
  if (!chart.points.length)
    throw new ApiError(
      422,
      "unsupported_ticker",
      "The provider could not validate this ticker. Check the symbol or retry later.",
    );
  const company = {
    ticker,
    name: chart.name,
    sector: "Not classified",
    validation: "Validated against Yahoo Finance",
    updated_at: chart.retrieved_at,
  };
  await run(
    "INSERT INTO companies(ticker,name,sector,validation,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(ticker) DO UPDATE SET name=excluded.name,validation=excluded.validation,updated_at=excluded.updated_at",
    ticker,
    company.name,
    company.sector,
    company.validation,
    company.updated_at,
  );
  await storeMarket(ticker, chart);
  return company;
}
export async function yahooMarket(ticker: string) {
  const origin = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const url = `${origin}?range=3mo&interval=1d&includeAdjustedClose=true`;
  const deadline = AbortSignal.timeout(20000);
  const load = async (source: string) => {
    const r = await fetch(source, {
      signal: deadline,
      headers: { "User-Agent": "FINN/1.0 financial research prototype" },
    });
    if (!r.ok)
      throw new ApiError(
        r.status === 429 ? 429 : 503,
        "market_source_unavailable",
        `The market-data provider returned ${r.status}. Last verified observations are retained.`,
      );
    const d = (await r.json()) as { chart: { result: YahooResult[] | null } };
    if (!d.chart.result?.[0]?.timestamp)
      throw new ApiError(
        422,
        "unsupported_ticker",
        "Ticker not found by the market provider.",
      );
    return d.chart.result[0];
  };
  const value = await load(url);
  let accepted: ReturnType<typeof verifiedYahooDaily>;
  try {
    accepted = verifiedYahooDaily(value, ticker);
  } catch (e) {
    throw new ApiError(
      503,
      "market_data_unverified",
      e instanceof Error ? e.message : "Daily data could not be verified.",
    );
  }
  const point_sources: Record<string, string> = Object.fromEntries(
    accepted.points.map((p) => [p.date, url]),
  );
  let history_error: string | null = null;
  // Newly listed symbols may return only the latest daily bar. One bounded previous-session
  // request can recover history, but intraday/default-range responses are never accepted.
  if (
    accepted.points.length === 1 &&
    value.meta.firstTradeDate &&
    Date.now() - value.meta.firstTradeDate * 1000 < 90 * 86400000
  ) {
    const end = Math.floor(
      +new Date(accepted.points[0].date + "T00:00:00+05:30") / 1000,
    );
    if (end > value.meta.firstTradeDate) {
      const previous = `${origin}?period1=${value.meta.firstTradeDate}&period2=${end}&interval=1d&includeAdjustedClose=true`;
      try {
        const history = verifiedYahooDaily(await load(previous), ticker);
        const rows = new Map(accepted.points.map((p) => [p.date, p]));
        for (const p of history.points.filter(
          (p) => p.date < accepted.points[0].date,
        )) {
          rows.set(p.date, p);
          point_sources[p.date] = previous;
        }
        accepted = {
          ...accepted,
          points: [...rows.values()].sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        };
      } catch (e) {
        history_error =
          e instanceof Error ? e.message : "Previous sessions unavailable.";
      }
    }
  }
  if (!accepted.points.length)
    throw new ApiError(
      503,
      "no_completed_sessions",
      "No valid completed daily bars are available. Stored observations are retained.",
    );
  return {
    name: value.meta.longName ?? value.meta.symbol ?? ticker,
    points: accepted.points,
    freshness: { ...accepted.freshness, history_error },
    point_sources,
    source: url,
    retrieved_at: new Date().toISOString(),
  };
}
export async function storeMarket(
  ticker: string,
  result: Awaited<ReturnType<typeof yahooMarket>>,
) {
  const old = new Set((await getPoints(ticker, "live")).map((p) => p.date));
  const statements = insertMany(
    "daily_prices",
    [
      "ticker",
      "date",
      "close",
      "adjusted_close",
      "volume",
      "source",
      "retrieved_at",
      "mode",
      "open",
      "high",
      "low",
      "provider",
      "completion_status",
    ],
    result.points
      .filter((p) => p.adjusted_close !== null)
      .map((p) => [
        ticker,
        p.date,
        p.close,
        p.adjusted_close,
        p.volume,
        result.point_sources?.[p.date] ?? result.source,
        result.retrieved_at,
        "live",
        p.open ?? null,
        p.high ?? null,
        p.low ?? null,
        "yahoo_finance",
        "verified_completed",
      ]),
    true,
  );
  statements.push(
    ...insertMany(
      "unadjusted_daily_prices",
      [
        "ticker",
        "date",
        "close",
        "volume",
        "source",
        "retrieved_at",
        "mode",
        "open",
        "high",
        "low",
        "provider",
        "completion_status",
      ],
      result.points
        .filter((p) => p.adjusted_close === null)
        .map((p) => [
          ticker,
          p.date,
          p.close,
          p.volume,
          result.point_sources?.[p.date] ?? result.source,
          result.retrieved_at,
          "live",
          p.open ?? null,
          p.high ?? null,
          p.low ?? null,
          "yahoo_finance",
          "verified_completed",
        ]),
      true,
    ),
  );
  statements.push(
    db()
      .prepare(
        "INSERT INTO source_sync(provider,ticker,last_success,last_attempt,status,details) VALUES ('market',?,?,?,'success',?) ON CONFLICT(provider,ticker) DO UPDATE SET last_success=excluded.last_success,last_attempt=excluded.last_attempt,status='success',error=NULL,details=excluded.details",
      )
      .bind(
        ticker,
        result.retrieved_at,
        result.retrieved_at,
        JSON.stringify(result.freshness),
      ),
  );
  await db().batch(statements);
  if (result.freshness.listing_date)
    await run(
      "INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      `listing:${ticker}`,
      JSON.stringify({
        date: result.freshness.listing_date,
        source: result.source,
        method: "Yahoo firstTradeDate for confirmed ticker",
      }),
    );
  return {
    inserted: result.points.filter((p) => !old.has(p.date)).length,
    duplicates: result.points.filter((p) => old.has(p.date)).length,
  };
}
const exchanges = [
  "nsearchives.nseindia.com",
  "archives.nseindia.com",
  "www.bseindia.com",
  "bseindia.com",
];
export function safeSourceUrl(raw: string, officialHost?: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !/^\d|:|\[|localhost|\.(?:local|localhost|internal|test)$/.test(
        u.hostname,
      ) &&
      (exchanges.includes(u.hostname) ||
        (!!officialHost &&
          (u.hostname === officialHost ||
            u.hostname.endsWith(`.${officialHost}`))))
    );
  } catch {
    return false;
  }
}
export async function discoverDocuments(
  ticker: string,
  task: {
    question?: string;
    type?: string;
    period?: string;
    queueOnly?: boolean;
  } = {},
) {
  try {
    return await trackSync("document_discovery", ticker, async () => {
      const before = await one<{ n: number }>(
        "SELECT count(*) n FROM documents WHERE ticker=?",
        ticker,
      );
      const result = await discoverDocumentsWork(ticker, task);
      const after = await one<{ n: number }>(
        "SELECT count(*) n FROM documents WHERE ticker=?",
        ticker,
      );
      const inserted = (after?.n ?? 0) - (before?.n ?? 0);
      if (result.indexed === 0 && result.failed > 0)
        throw new ApiError(
          503,
          "document_discovery_failed",
          result.limitations.join(" ").slice(0, 900),
        );
      return { ...result, discovered: result.candidates, inserted };
    });
  } catch (e) {
    return {
      limitations: [
        e instanceof ApiError ? e.message : "Document discovery failed.",
      ],
      status: "failed",
    };
  }
}
async function discoverDocumentsWork(
  ticker: string,
  task: {
    question?: string;
    type?: string;
    period?: string;
    queueOnly?: boolean;
  },
) {
  const limitations: string[] = [];
  const cachedCatalogue = await one<{ value: string }>(
    "SELECT value FROM meta WHERE key=?",
    `source-catalogue:${ticker}`,
  );
  const cached = (
    cachedCatalogue ? JSON.parse(cachedCatalogue.value) : null
  ) as {
    at: string;
    version?: string;
    result: Awaited<ReturnType<typeof locatePrimaryCandidates>>;
  } | null;
  const discovered =
    cached &&
    cached.version === DISCOVERY_VERSION &&
    Date.parse(cached.at) > Date.now() - 86400000
      ? cached.result
      : await locatePrimaryCandidates(ticker, safeSourceUrl);
  if (!cached || discovered !== cached.result)
    await run(
      "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
      `source-catalogue:${ticker}`,
      JSON.stringify({
        at: new Date().toISOString(),
        version: DISCOVERY_VERSION,
        result: discovered,
      }),
    );
  const { candidates } = discovered;
  for (const c of candidates) {
    await run(
      "INSERT INTO discovery_candidates(id,ticker,url,title,type,published_at,period,status,checked_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(ticker,url) DO UPDATE SET title=excluded.title,type=excluded.type,checked_at=excluded.checked_at",
      await sha(`${ticker}:${c.url}`),
      ticker,
      c.url,
      c.title,
      c.type,
      c.published_at,
      c.period,
      "discovered",
      new Date().toISOString(),
    );
  }
  const indexed = await all<{
    url: string;
    period: string;
    period_status: string;
    extraction_status: string;
    indexed_pages: number | null;
    total_pages: number | null;
  }>(
    "SELECT url,period,period_status,extraction_status,indexed_pages,total_pages FROM documents WHERE ticker=?",
    ticker,
  );
  const ranked = rankCandidates(
    candidates.map((c) => {
      const d = indexed.find((d) => d.url === c.url);
      return d
        ? {
            ...c,
            extraction_status: d.extraction_status,
            indexed_pages: d.indexed_pages,
            total_pages: d.total_pages,
            period:
              c.period ?? (d.period_status !== "unverified" ? d.period : null),
          }
        : c;
    }),
    task.question,
    task,
  ).filter((c) => !task.type || c.type === task.type);
  if (task.type && !ranked.length)
    limitations.push(
      `No permitted original ${task.type.replaceAll("_", " ")} was found in the current directory. Choose another document type or import a verified original.`,
    );
  // Pending/failed candidates remain resumable; one original is processed per interactive request.
  const pending = [];
  // Prepare only the best two relevant originals. An indexed current source must not
  // cause every new question to download progressively older reports.
  const relevant = ranked.filter((c) => c.type !== "announcement").slice(0, 2);
  const { enqueueDocument } = await import("./ingestion/document-jobs");
  for (const c of relevant) {
    const known = await one<{ id: string }>(
      "SELECT id FROM documents WHERE ticker=? AND url=? AND extraction_status='complete'",
      ticker,
      c.url,
    );
    if (known) {
      await run(
        "UPDATE discovery_candidates SET status='indexed',document_id=? WHERE ticker=? AND url=?",
        known.id,
        ticker,
        c.url,
      );
      continue;
    }
    const job = await one<{
      status: string;
      next_retry: string | null;
      attempts: number;
    }>(
      "SELECT status,next_retry,attempts FROM document_jobs WHERE ticker=? AND url=?",
      ticker,
      c.url,
    );
    if (
      job &&
      (job.attempts >= 3 ||
        ["complete", "manual_required", "running", "extracting"].includes(
          job.status,
        ) ||
        (job.next_retry && job.next_retry > new Date().toISOString()))
    )
      continue;
    const job_id = await enqueueDocument(ticker, c);
    pending.push({ ...c, job_id });
  }
  if (task.queueOnly)
    return {
      limitations,
      indexed: 0,
      failed: 0,
      candidates: candidates.length,
      discovered: candidates.length,
      status: "queued",
      job_ids: pending.slice(0, 2).map((c) => c.job_id),
    };
  let indexedCount = 0,
    failed = 0;
  const { processDocumentJobs } = await import("./ingestion/document-jobs");
  for (const candidate of pending.slice(0, 1)) {
    const processed = await processDocumentJobs(1, ticker, candidate.job_id);
    const result = processed.results[0];
    if (result && "document_id" in result && result.document_id) indexedCount++;
    if (result && result.status !== "complete") {
      failed++;
      limitations.push(
        result.error ??
          "Original text retained; financial extraction requires review.",
      );
    }
  }
  if (!candidates.length)
    limitations.push(
      "No permitted primary PDF links found. This is incomplete coverage, not proof of no disclosures.",
    );
  if (pending.length > 1)
    limitations.push(
      `${pending.length - 1} additional candidate documents remain pending a controlled refresh.`,
    );
  return {
    limitations: [...new Set(limitations)],
    indexed: indexedCount,
    failed,
    candidates: candidates.length,
    discovered: candidates.length,
    status: failed ? "partial" : "success",
  };
}
export async function ingestPdf(
  ticker: string,
  url: string,
  title: string,
  officialHost?: string,
  options: { background?: boolean; onStage?: (stage: string) => void } = {},
) {
  if (!officialHost) {
    officialHost = announcementSources.find(
      (s) => s.ticker === ticker,
    )?.officialHost;
  }
  if (!officialHost) {
    const trusted = await one<{ url: string }>(
      "SELECT url FROM documents WHERE ticker=? AND url NOT LIKE ? LIMIT 1",
      ticker,
      "%bseindia%",
    );
    if (trusted) {
      officialHost = new URL(trusted.url).hostname.replace(/^www\./, "");
    }
  }
  if (!safeSourceUrl(url, officialHost))
    throw new ApiError(
      400,
      "source_not_allowed",
      "Use a primary HTTPS exchange document or a verified company website.",
    );
  let destination = url;
  let r: Response | undefined;
  const deadline = AbortSignal.timeout(20000);
  for (let hop = 0; hop < 4; hop++) {
    r = await fetch(destination, { redirect: "manual", signal: deadline });
    if (![301, 302, 303, 307, 308].includes(r.status)) break;
    const location = r.headers.get("location");
    if (!location) break;
    const next = new URL(location, destination).href;
    if (!safeSourceUrl(next, officialHost))
      throw new ApiError(
        422,
        "source_redirect_rejected",
        "The document redirected outside its permitted primary-source hosts.",
      );
    await r.body?.cancel();
    destination = next;
  }
  if (!r)
    throw new ApiError(
      503,
      "document_source_unavailable",
      "Document fetch failed.",
    );
  if (!r.ok)
    throw new Error(
      `HTTP ${r.status}; source access restrictions were respected`,
    );
  const pdfConfig = env as unknown as {
    PDF_MAX_MB?: string;
    PDF_MAX_PAGES?: string;
  };
  const maxBytes =
    Math.max(
      1,
      Math.min(
        options.background ? 32 : 16,
        options.background ? 32 : Number(pdfConfig.PDF_MAX_MB) || 8,
      ),
    ) *
    1024 *
    1024;
  const declaredSize = Number(r.headers.get("content-length") ?? 0);
  if (declaredSize > 0)
    await run(
      "UPDATE discovery_candidates SET size_bytes=? WHERE ticker=? AND url=?",
      declaredSize,
      ticker,
      url,
    );
  if (Number(r.headers.get("content-length") ?? 0) > maxBytes)
    throw new Error(
      `Document exceeds the ${maxBytes / 1024 / 1024} MB limit; queued/background or protected original-file import is required.`,
    );
  const reader = r.body?.getReader();
  if (!reader) throw new Error("Empty document");
  const buffers: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.length;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error(`Document exceeds ${maxBytes / 1024 / 1024} MB`);
    }
    buffers.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const b of buffers) {
    bytes.set(b, offset);
    offset += b.length;
  }
  options.onStage?.("indexing");
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF") {
    if (
      /html|xml|xbrl/i.test(r.headers.get("content-type") ?? "") ||
      /\.(?:html?|xml|xbrl)(?:[?#]|$)/i.test(url)
    )
      return ingestStructuredSource(ticker, url, title, bytes, chunkPage);
    throw new ApiError(
      422,
      "unsupported_file_format",
      "Source did not return a valid PDF or supported original financial HTML/XBRL document.",
    );
  }
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const existing = await one<{ id: string }>(
    "SELECT id FROM documents WHERE hash=? AND ticker=?",
    hash,
    ticker,
  );
  if (
    existing &&
    (
      await one<{ value: string }>(
        "SELECT value FROM meta WHERE key=?",
        `layout-checked:${existing.id}`,
      )
    )?.value === PDF_LAYOUT_VERSION
  )
    return existing.id;
  if (
    await one(
      "SELECT id FROM documents WHERE hash=? AND ticker<>?",
      hash,
      ticker,
    )
  )
    throw new ApiError(
      422,
      "document_company_conflict",
      "This source is already associated with a different company.",
    );
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes, { maxImageSize: 1000000 });
  if (
    pdf.numPages >
    Math.max(1, Math.min(1000, Number(pdfConfig.PDF_MAX_PAGES) || 500))
  ) {
    await pdf.loadingTask.destroy();
    throw new Error("Document exceeds the 500-page limit");
  }
  const result = await extractText(pdf, { mergePages: false });
  const pages = result.text as string[];
  const layouts = await captureFinancialLayouts(pdf, pages);
  await pdf.loadingTask.destroy();
  const company = await one<{ name: string }>(
    "SELECT name FROM companies WHERE ticker=?",
    ticker,
  );
  const bodyText = pages
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const symbol = ticker
      .replace(/\.(NS|BO)$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
    name = company?.name
      .toLowerCase()
      .replace(/limited|ltd\.?|corporation/g, "")
      .replace(/[^a-z0-9]/g, "");
  if (
    !bodyText.includes(symbol) &&
    (!name || name.length < 6 || !bodyText.includes(name))
  )
    throw new ApiError(
      422,
      "document_company_unverified",
      "The PDF does not contain a matching company name or ticker. It was not indexed.",
    );

  if (pages.join("").trim().length < 80)
    throw new Error("No extractable text. Scanned documents require OCR.");
  const header = pages
    .slice(0, 4)
    .join(" ")
    .match(/Q([1-4])\s*FY\s*['’]?\s*(\d{2,4})/i);
  const fiscalPeriod = header
    ? `Q${header[1]} FY${Number(header[2]) < 100 ? 2000 + Number(header[2]) : header[2]}`
    : "Period not verified";
  const id = existing?.id ?? `live-${hash.slice(0, 20)}`,
    type = documentType(title + " " + url);
  const documentInsert = db()
    .prepare(
      "INSERT OR IGNORE INTO documents(id,ticker,title,type,period,url,published_at,retrieved_at,hash,mode,publisher,extraction_status,total_pages,indexed_pages) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      ticker,
      title,
      type,
      "Period not verified",
      url,
      null,
      new Date().toISOString(),
      hash,
      "live",
      new URL(url).hostname,
      pages.every((p) => p.trim().length > 0) ? "complete" : "partial",
      pages.length,
      pages.filter((p) => p.trim().length > 0).length,
    );
  const rows = pages.flatMap((text, p) =>
    chunkPage(text).map((text, i) => [
      `${id}:${p + 1}:${i}`,
      id,
      ticker,
      p + 1,
      text,
    ]),
  );
  const statements = insertMany(
    "document_chunks",
    ["id", "document_id", "ticker", "page", "text"],
    rows,
  );
  await db().batch([documentInsert, ...statements]);
  for (const layout of layouts)
    await run(
      "INSERT OR REPLACE INTO document_layouts(document_id,page,payload,version) VALUES (?,?,?,?)",
      id,
      layout.page,
      JSON.stringify(layout),
      PDF_LAYOUT_VERSION,
    );
  await run(
    "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
    `layout-checked:${id}`,
    PDF_LAYOUT_VERSION,
  );
  const registered = financialSources.find((c) => c.ticker === ticker);
  const verified = registered && {
    ...registered,
    currency:
      registered.currencyDocumentHash === hash
        ? registered.currency
        : undefined,
  };
  const parsed = extractPdfFinancials(
    layouts,
    { ticker, name: company?.name ?? ticker },
    verified,
  );
  if (parsed.calendar)
    await run(
      "INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)",
      `fiscal-calendar:${ticker}`,
      JSON.stringify({ ...parsed.calendar, source: url, document_id: id }),
    );
  const tablePeriod =
    sortPeriods([
      ...parsed.metrics.map((m) => m.period),
      ...parsed.periods,
    ]).find((p) => p.startsWith("Q")) ??
    sortPeriods([...parsed.metrics.map((m) => m.period), ...parsed.periods])[0];
  if (tablePeriod)
    await run(
      "UPDATE documents SET period=?,period_status='source_table_header' WHERE id=?",
      tablePeriod,
      id,
    );
  if (header && !tablePeriod)
    await run(
      "UPDATE documents SET period=?,period_status='source_header' WHERE id=?",
      fiscalPeriod,
      id,
    );
  return id;
}
