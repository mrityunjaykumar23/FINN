import {
  sqliteTable,
  text,
  real,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const companies = sqliteTable("companies", {
  ticker: text("ticker").primaryKey(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  validation: text("validation").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const portfolio = sqliteTable(
  "portfolio_companies",
  {
    owner: text("owner").notNull(),
    ticker: text("ticker").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.ticker] })],
);
export const preferences = sqliteTable("alert_preferences", {
  owner: text("owner").primaryKey(),
  settings: text("settings").notNull(),
});
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  ticker: text("ticker").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  period: text("period").notNull(),
  url: text("url").notNull(),
  publishedAt: text("published_at"),
  retrievedAt: text("retrieved_at").notNull(),
  hash: text("hash").notNull().unique(),
  mode: text("mode").notNull(),
});
export const chunks = sqliteTable("document_chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  ticker: text("ticker").notNull(),
  page: integer("page").notNull(),
  text: text("text").notNull(),
});
export const announcements = sqliteTable("announcements", {
  id: text("id").primaryKey(),
  ticker: text("ticker").notNull(),
  hash: text("hash").notNull().unique(),
  documentId: text("document_id").notNull(),
  date: text("date").notNull(),
  payload: text("payload").notNull(),
});
export const prices = sqliteTable(
  "daily_prices",
  {
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    close: real("close").notNull(),
    adjustedClose: real("adjusted_close").notNull(),
    volume: real("volume").notNull(),
    source: text("source").notNull(),
    retrievedAt: text("retrieved_at").notNull(),
    mode: text("mode").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.date, t.mode] })],
);
export const metrics = sqliteTable("financial_metrics", {
  id: text("id").primaryKey(),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  value: real("value"),
  period: text("period").notNull(),
  unit: text("unit").notNull(),
  basis: text("basis").notNull(),
  documentId: text("document_id").notNull(),
  page: integer("page").notNull(),
});
export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  payload: text("payload").notNull(),
  triggeredAt: text("triggered_at").notNull(),
});
export const cache = sqliteTable("analysis_cache", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
