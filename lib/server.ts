import { env } from "cloudflare:workers";
import seedData from "../data/seed.json";
import {
  defaultSettings,
  marketSummary,
  evaluateMarket,
  rank,
  inWindow,
  compareGuidance,
  normalizeTicker,
  retrieve,
  type Point,
  type Settings,
  type Filing,
  type Metric,
} from "./domain";
import type { Company, Document, Research, RankedFiling } from "./types";
import { calculateFindings } from "./research-analysis";
import { inferHeaderPeriod } from "./financial-extraction";
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
import {
  db,
  all,
  one,
  run,
  sha,
  ApiError,
  budget,
  lock,
  unlock,
} from "../db/repository";
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
      "UPDATE documents SET publisher=?,extraction_status=?,total_pages=?,indexed_pages=?,period_status='reviewed' WHERE id=?",
      new URL(d.url).hostname,
      (d as Document & { total_pages?: number }).total_pages! > d.pages.length
        ? "partial"
        : "complete",
      (d as Document & { total_pages?: number }).total_pages ?? d.pages.length,
      d.pages.length,
      d.id,
    );
}
let initialization: Promise<void> | null = null;
export async function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    if (await one("SELECT value FROM meta WHERE key = ?", seed.version)) {
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
export async function getPoints(ticker: string, mode = "historical") {
  return all<Point>(
    "SELECT date,close,adjusted_close,volume FROM daily_prices WHERE ticker=? AND mode=? ORDER BY date",
    ticker,
    mode,
  );
}
export async function portfolioFor(owner: string, mode = "historical") {
  const [companies, settings, filings] = await Promise.all([
    all<Company>(
      "SELECT c.* FROM companies c JOIN portfolio_companies p ON p.ticker=c.ticker WHERE p.owner=? ORDER BY c.name",
      owner,
    ),
    getSettings(owner),
    getFilings(),
  ]);
  return Promise.all(
    companies.map(async (c) => ({
      ...c,
      ...marketSummary(
        await getPoints(c.ticker, mode),
        settings.volume_lookback,
      ),
      events: filings.filter((f) => f.ticker === c.ticker && f.severity >= 20)
        .length,
    })),
  );
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
  const clauses: string[] = [],
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
    "SELECT id,ticker,name,value,period,unit,basis,document_id,page FROM financial_metrics WHERE ticker=? AND verification_status<>'unverified'",
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
  const mode = params.get("mode") === "live" ? "live" : "historical";
  const end =
    params.get("end") ??
    (mode === "historical"
      ? seed.as_of
      : new Date().toISOString().slice(0, 10));
  const days = Math.min(3650, Math.max(1, Number(params.get("days") ?? 1)));
  const start =
    params.get("start") ??
    new Date(new Date(end + "T00:00:00Z").getTime() - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  const [portfolio, settings, filings] = await Promise.all([
    portfolioFor(owner, mode),
    getSettings(owner),
    getFilings({
      mode,
      start,
      end,
      ticker: params.get("ticker") ?? undefined,
      category: params.get("category") ?? undefined,
    }),
  ]);
  const tickers = new Set(portfolio.map((c) => c.ticker));
  const relevant = filings.filter(
    (f) =>
      tickers.has(f.ticker) &&
      inWindow(f.date, start, end) &&
      (!params.get("ticker") || f.ticker === params.get("ticker")) &&
      (!params.get("category") || f.category === params.get("category")),
  );
  const ranked = (
    await Promise.all(relevant.map((f) => eventDetail(f, settings)))
  ).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  const surfaced = ranked.filter(
    (f) =>
      f.score >= settings.min_priority &&
      settings.enabled_categories.includes(f.category),
  );
  const routine = ranked.filter((f) => !surfaced.some((s) => s.id === f.id));
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
  await evaluateAlerts(owner, mode, start, end);
  const covered = new Set(filings.map((f) => f.ticker));
  return {
    mode,
    start,
    end,
    events: surfaced,
    routine,
    market_alerts: movements,
    total: ranked.length,
    companies: portfolio.length,
    covered_companies: portfolio.filter((c) => covered.has(c.ticker)).length,
    unavailable_companies: portfolio.filter((c) => !c.date).length,
    source_note:
      mode === "historical"
        ? "Historical replay. Cached official company disclosures; limited filing coverage, not a complete exchange feed. Dates are original event dates. EOD prices are Yahoo Finance observations."
        : "Live mode never substitutes the historical snapshot. Refresh market data to retrieve recent sessions; exchange ingestion is administrator-controlled.",
  };
}
export async function guidanceFor(ticker?: string) {
  return guidanceRows(ticker);
}
export async function research(
  ticker: string,
  question: string,
  filters: { period?: string; type?: string } = {},
): Promise<Research> {
  const docs = await all<Omit<Document, "pages">>(
    "SELECT * FROM documents WHERE ticker=? ORDER BY published_at DESC",
    ticker,
  );
  const missing: string[] = [];
  if (!docs.length) {
    const discovery = await discoverDocuments(ticker);
    missing.push(...discovery.limitations);
    docs.push(
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
    if (!count?.n)
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
  const version = docs
    .map((d) => d.hash)
    .sort()
    .join(":");
  const config = providerStatus();
  const key = await sha(
    `${ticker}:${version}:${question.trim().toLowerCase()}:${JSON.stringify(filters)}:rag-v6:${config.enabled}:${config.model}:${PROMPT_VERSION}:${await sha(JSON.stringify(await all<Metric>("SELECT * FROM financial_metrics WHERE ticker=? AND verification_status<>'unverified' ORDER BY id", ticker)))}`,
  );
  const cached = await one<{ payload: string }>(
    "SELECT payload FROM analysis_cache WHERE key=? AND expires_at>?",
    key,
    new Date().toISOString(),
  );
  if (cached) return { ...JSON.parse(cached.payload), cached: true };
  const passages = await all<{
    ticker: string;
    text: string;
    page: number;
    document_id: string;
    title: string;
    url: string;
    period: string;
    type: string;
  }>(
    "SELECT c.ticker,c.text,c.page,c.document_id,d.title,d.url,d.period,d.type FROM document_chunks c JOIN documents d ON d.id=c.document_id WHERE c.ticker=? ORDER BY d.published_at DESC,c.page LIMIT 2500",
    ticker,
  );
  // Prefer FTS-ranked candidates; bounded lexical fallback preserves useful financial aliases.
  let candidates = passages;
  const terms = question
    .match(/[a-zA-Z]{3,}/g)
    ?.slice(0, 15)
    .map((t) => `"${t}"`)
    .join(" OR ");
  if (terms) {
    try {
      const hits = await all<{
        document_id: string;
        page: number;
        text: string;
      }>(
        "SELECT c.document_id,c.page,c.text FROM chunks_fts JOIN document_chunks c ON c.id=chunks_fts.chunk_id JOIN documents d ON d.id=c.document_id WHERE chunks_fts MATCH ? AND c.ticker=? ORDER BY rank LIMIT 60",
        terms,
        ticker,
      );
      if (hits.length)
        candidates = [
          ...hits.flatMap((h) =>
            passages.filter(
              (p) =>
                p.document_id === h.document_id &&
                p.page === h.page &&
                p.text === h.text,
            ),
          ),
          ...passages,
        ];
    } catch {
      /* FTS is an optimization; the deterministic retriever remains supported. */
    }
  }
  const requestedPeriod =
    filters.period ??
    question.match(/(?:Q[1-4]\s+)?FY\d{4}/i)?.[0]?.toUpperCase();
  if (requestedPeriod) filters = { ...filters, period: requestedPeriod };
  const selected = retrieve(candidates, ticker, question, filters, 8).filter(
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
    url: `${s.url}#page=${s.page}`,
    text: s.text,
    period: s.period,
  }));
  const metrics = await all<Metric>(
    "SELECT * FROM financial_metrics WHERE ticker=? AND verification_status<>'unverified'",
    ticker,
  );
  await persistComparisons(ticker, metrics);
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
  const calculated = !filters.type
    ? calculateFindings(
        ticker,
        question,
        metrics,
        await guidanceRows(ticker),
        requestedPeriod,
      )
    : [];
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
            url: `${document.url}#page=${location.page}`,
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
        verification: "source_checked",
      });
      output.summary = answer.concise_summary.claim;
      output.key_findings = [
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
      output.model_used = config.model!;
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(16000),
    headers: { "User-Agent": "FINN/1.0 financial research prototype" },
  });
  if (!r.ok)
    throw new ApiError(
      r.status === 429 ? 429 : 503,
      "market_source_unavailable",
      `The market-data provider returned ${r.status}. No synthetic data was substituted.`,
    );
  const data = (await r.json()) as {
    chart: {
      result:
        | {
            timestamp: number[];
            meta: { longName?: string; symbol?: string };
            indicators: {
              quote: { close: number[]; volume: number[] }[];
              adjclose?: { adjclose: number[] }[];
            };
          }[]
        | null;
    };
  };
  const value = data.chart.result?.[0];
  if (!value?.timestamp)
    throw new ApiError(
      422,
      "unsupported_ticker",
      "Ticker not found by the market provider.",
    );
  const quote = value.indicators.quote[0],
    adjusted = value.indicators.adjclose?.[0]?.adjclose ?? quote.close;
  // Exclude the current Indian calendar day: a chart can include an unfinished session.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const points = value.timestamp
    .map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      close: quote.close[i],
      adjusted_close: adjusted[i],
      volume: quote.volume[i],
    }))
    .filter(
      (p) =>
        p.date < today &&
        [p.close, p.adjusted_close, p.volume].every(Number.isFinite),
    );
  return {
    name: value.meta.longName ?? value.meta.symbol ?? ticker,
    points,
    source: url,
    retrieved_at: new Date().toISOString(),
  };
}
export async function storeMarket(
  ticker: string,
  result: Awaited<ReturnType<typeof yahooMarket>>,
) {
  const old = new Set(
    (
      await all<{ date: string }>(
        "SELECT date FROM daily_prices WHERE ticker=? AND mode=?",
        ticker,
        "live",
      )
    ).map((p) => p.date),
  );
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
    ],
    result.points.map((p) => [
      ticker,
      p.date,
      p.close,
      p.adjusted_close,
      p.volume,
      result.source,
      result.retrieved_at,
      "live",
    ]),
    true,
  );
  statements.push(
    db()
      .prepare(
        "INSERT INTO source_sync(provider,ticker,last_success,last_attempt,status) VALUES ('market',?,?,?,'success') ON CONFLICT(provider,ticker) DO UPDATE SET last_success=excluded.last_success,last_attempt=excluded.last_attempt,status='success',error=NULL",
      )
      .bind(ticker, result.retrieved_at, result.retrieved_at),
  );
  await db().batch(statements);
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
      !/^\d|localhost|\.local$/.test(u.hostname) &&
      (exchanges.includes(u.hostname) ||
        (!!officialHost &&
          (u.hostname === officialHost ||
            u.hostname.endsWith(`.${officialHost}`))))
    );
  } catch {
    return false;
  }
}
export async function discoverDocuments(ticker: string) {
  try {
    return await trackSync("document_discovery", ticker, async () => {
      const before = await one<{ n: number }>(
        "SELECT count(*) n FROM documents WHERE ticker=?",
        ticker,
      );
      const result = await discoverDocumentsWork(ticker);
      const after = await one<{ n: number }>(
        "SELECT count(*) n FROM documents WHERE ticker=?",
        ticker,
      );
      const inserted = (after?.n ?? 0) - (before?.n ?? 0);
      if (result.limitations.length && !inserted)
        throw new ApiError(
          503,
          "document_discovery_failed",
          result.limitations.join(" ").slice(0, 900),
        );
      return { ...result, discovered: inserted, inserted };
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
async function discoverDocumentsWork(ticker: string) {
  const limitations: string[] = [];
  const symbol = ticker.replace(/\.(NS|BO)$/, "");
  try {
    const url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "FINN/1.0 primary-document discovery" },
    });
    if (!r.ok)
      return {
        limitations: [
          `Document discovery returned HTTP ${r.status}. No access-control bypass was attempted. Import an authentic filing through the protected ingestion route.`,
        ],
      };
    const html = await r.text();
    // Screener is a link directory only. Its financial tables and opinions are never evidence.
    const websiteMatch = html.match(
      /href=["'](https:\/\/[^"']+)["'][^>]*>\s*(?:[\s\S]{0,150}?)?(?:Website|Company website)/i,
    );
    let officialHost: string | undefined;
    if (websiteMatch) {
      try {
        officialHost = new URL(websiteMatch[1]).hostname.replace(/^www\./, "");
      } catch {}
    }
    const links = [
      ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
    ].map((m) => ({
      url: m[1].replace(/&amp;/g, "&"),
      label: m[2]
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    }));
    const candidates = links
      .filter(
        (l) =>
          /\.pdf(?:\?|$)/i.test(l.url) &&
          safeSourceUrl(l.url, officialHost) &&
          /annual|report|transcript|concall|result|presentation/i.test(
            l.label + l.url,
          ),
      )
      .slice(0, 3);
    if (!candidates.length)
      limitations.push(
        "No permitted primary PDF links were discovered. This may be an upstream layout or access restriction; no company facts were inferred.",
      );
    for (const link of candidates) {
      try {
        const documentId = await ingestPdf(
          ticker,
          link.url,
          link.label || "Primary company document",
          officialHost,
        );
        await extractDocument(ticker, documentId).catch(() => {
          limitations.push(
            "Gemini extraction unavailable; original source text remains indexed.",
          );
        });
      } catch (e) {
        limitations.push(
          `A primary document could not be indexed: ${e instanceof Error ? e.message : "source unavailable"}`,
        );
      }
    }
  } catch {
    limitations.push(
      "Primary-document discovery timed out or was unavailable. Research requires a retrievable primary source.",
    );
  }
  return { limitations };
}
export async function ingestPdf(
  ticker: string,
  url: string,
  title: string,
  officialHost?: string,
) {
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
  const maxBytes = 8 * 1024 * 1024;
  if (Number(r.headers.get("content-length") ?? 0) > maxBytes)
    throw new Error(
      "Document exceeds the 8 MB interactive limit; use Python ingestion.",
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
      throw new Error("Document exceeds 8 MB");
    }
    buffers.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const b of buffers) {
    bytes.set(b, offset);
    offset += b.length;
  }
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF")
    throw new Error("Source did not return a valid PDF");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const existing = await one<{ id: string }>(
    "SELECT id FROM documents WHERE hash=? AND ticker=?",
    hash,
    ticker,
  );
  if (existing) return existing.id;
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
  if (pdf.numPages > 500) {
    await pdf.loadingTask.destroy();
    throw new Error("Document exceeds the 500-page limit");
  }
  const result = await extractText(pdf, { mergePages: false });
  await pdf.loadingTask.destroy();
  const pages = result.text as string[];
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
  const id = `live-${hash.slice(0, 20)}`,
    type = /transcript|concall/i.test(title + url)
      ? "transcript"
      : /annual/i.test(title + url)
        ? "annual_report"
        : "results";
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
      "complete",
      pages.length,
      pages.length,
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
  if (header)
    await run(
      "UPDATE documents SET period=?,period_status='source_header' WHERE id=?",
      fiscalPeriod,
      id,
    );
  return id;
}
