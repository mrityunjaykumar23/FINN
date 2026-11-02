// Mirrors the incremental SQL schema. FTS5 and synchronization triggers live in 0001_integrity.sql.
import {
  sqliteTable,
  text,
  real,
  integer,
  primaryKey,
  foreignKey,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const companies = sqliteTable("companies", {
  ticker: text("ticker").notNull().primaryKey(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  validation: text("validation").notNull(),
  updated_at: text("updated_at").notNull(),
});
export const owners = sqliteTable("owners", {
  id: text("id").notNull().primaryKey(),
  created_at: text("created_at").notNull(),
  initialized_at: text("initialized_at"),
});
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").notNull().primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references((): AnySQLiteColumn => companies.ticker, {
        onDelete: "restrict",
      }),
    title: text("title").notNull(),
    type: text("type").notNull(),
    period: text("period").notNull(),
    url: text("url").notNull(),
    published_at: text("published_at"),
    retrieved_at: text("retrieved_at").notNull(),
    hash: text("hash").notNull(),
    mode: text("mode").notNull(),
    publisher: text("publisher"),
    extraction_status: text("extraction_status")
      .notNull()
      .default(sql`'complete'`),
    total_pages: integer("total_pages"),
    indexed_pages: integer("indexed_pages"),
    period_status: text("period_status").notNull().default("unverified"),
  },
  (t) => [
    index("documents_ticker_type_period").on(t.ticker, t.type, t.period),
    uniqueIndex("documents_id_ticker_unique").on(t.id, t.ticker),
    uniqueIndex("documents_hash_unique").on(t.hash),
  ],
);
export const chunks = sqliteTable(
  "document_chunks",
  {
    id: text("id").notNull().primaryKey(),
    document_id: text("document_id").notNull(),
    ticker: text("ticker").notNull(),
    page: integer("page").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.document_id, t.ticker],
      foreignColumns: [documents.id, documents.ticker],
    }).onDelete("cascade"),
    index("chunks_document_page").on(t.document_id, t.page),
  ],
);
export const portfolio = sqliteTable(
  "portfolio_companies",
  {
    owner: text("owner")
      .notNull()
      .references((): AnySQLiteColumn => owners.id, { onDelete: "cascade" }),
    ticker: text("ticker")
      .notNull()
      .references((): AnySQLiteColumn => companies.ticker, {
        onDelete: "restrict",
      }),
    created_at: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.ticker] })],
);
export const preferences = sqliteTable("alert_preferences", {
  owner: text("owner")
    .notNull()
    .primaryKey()
    .references((): AnySQLiteColumn => owners.id, { onDelete: "cascade" }),
  settings: text("settings").notNull(),
});
export const prices = sqliteTable(
  "daily_prices",
  {
    ticker: text("ticker")
      .notNull()
      .references((): AnySQLiteColumn => companies.ticker, {
        onDelete: "restrict",
      }),
    date: text("date").notNull(),
    close: real("close").notNull(),
    adjusted_close: real("adjusted_close").notNull(),
    volume: real("volume").notNull(),
    source: text("source").notNull(),
    retrieved_at: text("retrieved_at").notNull(),
    mode: text("mode").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ticker, t.date, t.mode] }),
    index("prices_ticker_mode_date").on(t.ticker, t.mode, t.date),
  ],
);
export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").notNull().primaryKey(),
    ticker: text("ticker").notNull(),
    hash: text("hash").notNull(),
    document_id: text("document_id").notNull(),
    date: text("date").notNull(),
    payload: text("payload").notNull(),
    event_signature: text("event_signature"),
    exchange_filing_id: text("exchange_filing_id"),
    headline: text("headline")
      .notNull()
      .default(sql`''`),
    category: text("category")
      .notNull()
      .default(sql`'unclassified'`),
    summary: text("summary")
      .notNull()
      .default(sql`''`),
    why_it_matters: text("why_it_matters")
      .notNull()
      .default(sql`''`),
    published_at: text("published_at"),
    detected_at: text("detected_at"),
    source_url: text("source_url"),
    classification_method: text("classification_method")
      .notNull()
      .default(sql`'human_reviewed'`),
    classification_confidence: text("classification_confidence"),
    materiality_score: real("materiality_score")
      .notNull()
      .default(sql`0`),
    materiality_reason: text("materiality_reason"),
    severity: real("severity")
      .notNull()
      .default(sql`0`),
    magnitude: real("magnitude")
      .notNull()
      .default(sql`0`),
    novelty: real("novelty")
      .notNull()
      .default(sql`0`),
    evidence_coverage: real("evidence_coverage")
      .notNull()
      .default(sql`0`),
    verification_status: text("verification_status")
      .notNull()
      .default(sql`'source_linked'`),
    ingestion_mode: text("ingestion_mode")
      .notNull()
      .default(sql`'historical'`),
  },
  (t) => [
    foreignKey({
      columns: [t.document_id, t.ticker],
      foreignColumns: [documents.id, documents.ticker],
    }).onDelete("restrict"),
    index("announcements_mode_date").on(t.ingestion_mode, t.published_at),
    index("announcements_category_priority").on(
      t.category,
      t.materiality_score,
    ),
    index("announcements_ticker_date").on(t.ticker, t.published_at),
    uniqueIndex("announcements_hash_unique").on(t.hash),
    uniqueIndex("announcements_event_identity").on(
      t.ticker,
      t.document_id,
      t.event_signature,
    ),
    index("announcements_page_order").on(t.date, t.id),
  ],
);
export const metrics = sqliteTable(
  "financial_metrics",
  {
    id: text("id").notNull().primaryKey(),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    value: real("value"),
    period: text("period").notNull(),
    unit: text("unit").notNull(),
    basis: text("basis").notNull(),
    document_id: text("document_id").notNull(),
    page: integer("page").notNull(),
    currency: text("currency"),
    scale: text("scale"),
    fiscal_year: integer("fiscal_year"),
    fiscal_quarter: integer("fiscal_quarter"),
    period_start: text("period_start"),
    period_end: text("period_end"),
    value_type: text("value_type")
      .notNull()
      .default(sql`'reported'`),
    reporting_status: text("reporting_status")
      .notNull()
      .default(sql`'reported'`),
    calculation_method: text("calculation_method"),
    evidence_text: text("evidence_text")
      .notNull()
      .default(sql`''`),
    extraction_method: text("extraction_method")
      .notNull()
      .default(sql`'reviewed_seed'`),
    verification_status: text("verification_status")
      .notNull()
      .default(sql`'reviewed'`),
    updated_at: text("updated_at")
      .notNull()
      .default(sql`''`),
  },
  (t) => [
    foreignKey({
      columns: [t.document_id, t.ticker],
      foreignColumns: [documents.id, documents.ticker],
    }).onDelete("restrict"),
    index("metrics_comparable").on(t.ticker, t.name, t.period, t.basis),
    index("metrics_guidance_actual").on(
      t.ticker,
      t.name,
      t.period,
      t.basis,
      t.unit,
    ),
  ],
);
export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").notNull().primaryKey(),
    owner: text("owner")
      .notNull()
      .references((): AnySQLiteColumn => owners.id, { onDelete: "cascade" }),
    payload: text("payload").notNull(),
    triggered_at: text("triggered_at").notNull(),
    ticker: text("ticker").references((): AnySQLiteColumn => companies.ticker, {
      onDelete: "restrict",
    }),
    event_type: text("event_type")
      .notNull()
      .default(sql`'legacy'`),
    rule_id: text("rule_id"),
    event_reference: text("event_reference"),
    announcement_id: text("announcement_id").references(
      (): AnySQLiteColumn => announcements.id,
      { onDelete: "restrict" },
    ),
    observed_at: text("observed_at"),
    status: text("status")
      .notNull()
      .default(sql`'unread'`),
    read_at: text("read_at"),
    dismissed_at: text("dismissed_at"),
    priority: real("priority")
      .notNull()
      .default(sql`0`),
    evidence_reference: text("evidence_reference"),
    mode: text("mode")
      .notNull()
      .default(sql`'historical'`),
  },
  (t) => [
    index("alerts_owner_state_time").on(t.owner, t.status, t.triggered_at),
  ],
);
export const cache = sqliteTable(
  "analysis_cache",
  {
    key: text("key").notNull().primaryKey(),
    payload: text("payload").notNull(),
    created_at: text("created_at").notNull(),
    expires_at: text("expires_at"),
    ticker: text("ticker"),
    document_version: text("document_version"),
    metric_version: text("metric_version"),
    model: text("model"),
    prompt_version: text("prompt_version"),
    kind: text("kind")
      .notNull()
      .default(sql`'research'`),
  },
  (t) => [
    index("cache_document_version").on(t.ticker, t.document_version),
    index("cache_expiry").on(t.expires_at),
  ],
);
export const guidanceStatements = sqliteTable(
  "guidance_statements",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker").notNull(),
    metric: text("metric").notNull(),
    statement_text: text("statement_text").notNull(),
    guidance_type: text("guidance_type").notNull(),
    target_min: real("target_min"),
    target_max: real("target_max"),
    unit: text("unit").notNull(),
    basis: text("basis").notNull(),
    stated_at: text("stated_at"),
    target_period: text("target_period").notNull(),
    document_id: text("document_id").notNull(),
    page: integer("page").notNull(),
    relevant_quote: text("relevant_quote").notNull(),
    qualifiers: text("qualifiers")
      .notNull()
      .default(sql`''`),
    extraction_confidence: real("extraction_confidence")
      .notNull()
      .default(sql`0`),
    verification_status: text("verification_status")
      .notNull()
      .default(sql`'source_checked'`),
    revision_of: text("revision_of").references(
      (): AnySQLiteColumn => guidanceStatements.id,
      { onDelete: "no action" },
    ),
  },
  (t) => [
    foreignKey({
      columns: [t.document_id, t.ticker],
      foreignColumns: [documents.id, documents.ticker],
    }).onDelete("restrict"),
    index("guidance_target").on(t.ticker, t.metric, t.target_period),
    uniqueIndex(
      "guidance_statements_ticker_metric_target_period_document_id_page_basis_unique",
    ).on(t.ticker, t.metric, t.target_period, t.document_id, t.page, t.basis),
  ],
);
export const guidanceComparisons = sqliteTable(
  "guidance_comparisons",
  {
    id: text("id").primaryKey(),
    statement_id: text("statement_id")
      .notNull()
      .references((): AnySQLiteColumn => guidanceStatements.id, {
        onDelete: "cascade",
      }),
    metric_id: text("metric_id")
      .notNull()
      .references((): AnySQLiteColumn => metrics.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    variance: real("variance"),
    explanation: text("explanation").notNull(),
    compared_at: text("compared_at").notNull(),
  },
  (t) => [
    uniqueIndex("guidance_comparisons_statement_id_metric_id_unique").on(
      t.statement_id,
      t.metric_id,
    ),
  ],
);
export const ingestionRuns = sqliteTable(
  "ingestion_runs",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    ticker: text("ticker").references((): AnySQLiteColumn => companies.ticker, {
      onDelete: "no action",
    }),
    started_at: text("started_at").notNull(),
    finished_at: text("finished_at"),
    status: text("status").notNull(),
    discovered: integer("discovered")
      .notNull()
      .default(sql`0`),
    inserted: integer("inserted")
      .notNull()
      .default(sql`0`),
    duplicates: integer("duplicates")
      .notNull()
      .default(sql`0`),
    error: text("error"),
    details: text("details")
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [
    index("runs_provider_ticker_time").on(t.provider, t.ticker, t.started_at),
  ],
);
export const sourceSync = sqliteTable(
  "source_sync",
  {
    provider: text("provider").notNull(),
    ticker: text("ticker")
      .notNull()
      .references((): AnySQLiteColumn => companies.ticker, {
        onDelete: "no action",
      }),
    last_success: text("last_success"),
    last_attempt: text("last_attempt"),
    next_retry: text("next_retry"),
    status: text("status").notNull(),
    error: text("error"),
    cursor: text("cursor"),
    discovered: integer("discovered").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    manual_required: integer("manual_required").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    pending: integer("pending").notNull().default(0),
    discovery_cursor: text("discovery_cursor"),
    details: text("details")
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [primaryKey({ columns: [t.provider, t.ticker] })],
);
export const companyVersions = sqliteTable("company_versions", {
  ticker: text("ticker")
    .primaryKey()
    .references(() => companies.ticker),
  revision: integer("revision").notNull().default(0),
});
export const extractionAudit = sqliteTable("extraction_audit", {
  id: text("id").primaryKey(),
  document_id: text("document_id")
    .notNull()
    .references(() => documents.id),
  method: text("method").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  created_at: text("created_at").notNull(),
});
export const discoveryCandidates = sqliteTable(
  "discovery_candidates",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    url: text("url").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    published_at: text("published_at"),
    period: text("period"),
    size_bytes: integer("size_bytes"),
    status: text("status").notNull(),
    detail: text("detail"),
    document_id: text("document_id").references(() => documents.id),
    checked_at: text("checked_at").notNull(),
    provider: text("provider")
      .notNull()
      .default(sql`'original_link_directory'`),
    external_id: text("external_id"),
    publication_precision: text("publication_precision")
      .notNull()
      .default(sql`'unknown'`),
    publication_timezone: text("publication_timezone"),
    source_timestamp: text("source_timestamp"),
    verification_status: text("verification_status")
      .notNull()
      .default(sql`'candidate'`),
    processing_status: text("processing_status")
      .notNull()
      .default(sql`'pending'`),
    attempts: integer("attempts").notNull().default(0),
    next_retry: text("next_retry"),
  },
  (t) => [
    uniqueIndex("candidate_url").on(t.ticker, t.url),
    index("candidate_status").on(t.ticker, t.status),
    index("candidate_processing").on(
      t.ticker,
      t.provider,
      t.processing_status,
      t.published_at,
    ),
  ],
);
export const documentJobs = sqliteTable(
  "document_jobs",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    url: text("url").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    official_host: text("official_host"),
    status: text("status")
      .notNull()
      .default(sql`'pending'`),
    attempts: integer("attempts").notNull().default(0),
    next_retry: text("next_retry"),
    error: text("error"),
    document_id: text("document_id").references(() => documents.id),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("document_job_url").on(t.ticker, t.url),
    index("document_job_pending").on(t.status, t.next_retry),
  ],
);
export const requestBudgets = sqliteTable(
  "request_budgets",
  {
    scope: text("scope").notNull(),
    bucket: text("bucket").notNull(),
    used: integer("used")
      .notNull()
      .default(sql`0`),
  },
  (t) => [primaryKey({ columns: [t.scope, t.bucket] })],
);
export const aiOperations = sqliteTable("ai_operations", {
  id: text("id").primaryKey(),
  ticker: text("ticker"),
  task: text("task").notNull(),
  model: text("model"),
  status: text("status").notNull(),
  created_at: text("created_at").notNull(),
  duration_ms: integer("duration_ms")
    .notNull()
    .default(sql`0`),
  input_tokens: integer("input_tokens")
    .notNull()
    .default(sql`0`),
  output_tokens: integer("output_tokens")
    .notNull()
    .default(sql`0`),
  cache_hit: integer("cache_hit")
    .notNull()
    .default(sql`0`),
  error_code: text("error_code"),
});
export const jobLocks = sqliteTable("job_locks", {
  key: text("key").primaryKey(),
  expires_at: text("expires_at").notNull(),
});
export const meta = sqliteTable("meta", {
  key: text("key").notNull().primaryKey(),
  value: text("value").notNull(),
});
export const metricDerivations = sqliteTable(
  "metric_derivations",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker")
      .notNull()
      .references(() => companies.ticker),
    name: text("name").notNull(),
    current_metric_id: text("current_metric_id")
      .notNull()
      .references(() => metrics.id),
    base_metric_id: text("base_metric_id")
      .notNull()
      .references(() => metrics.id),
    value: real("value").notNull(),
    unit: text("unit").notNull(),
    formula: text("formula").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("derivations_inputs_unique").on(
      t.name,
      t.current_metric_id,
      t.base_metric_id,
    ),
  ],
);
