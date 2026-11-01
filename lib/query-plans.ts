import { retrievalTerms } from "./domain.ts";
export const RETRIEVAL_VERSION = "sql-fts-v3";
export const companySyncBatch = (tickers: string[], after?: string) => {
  const ordered = [...new Set(tickers)]
    .sort()
    .filter((t) => !after || t > after);
  return {
    batch: ordered.slice(0, 3),
    next_cursor: ordered.length > 3 ? ordered[2] : null,
  };
};
export type FilingFilters = {
  ticker?: string;
  start?: string;
  end?: string;
  category?: string;
  mode?: string;
  priority?: number;
  limit?: number;
  cursor?: string;
};
export function filingPageQuery(filters: FilingFilters = {}) {
  const clauses: string[] = [
      "json_extract(payload,'$.canonical_event_id') IS NULL",
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
  if (filters.cursor) {
    let c: unknown;
    try {
      c = JSON.parse(atob(filters.cursor));
    } catch {
      throw new Error("Invalid announcement cursor");
    }
    if (
      !Array.isArray(c) ||
      c.length !== 2 ||
      !c.every((x) => typeof x === "string" && x.length <= 160)
    )
      throw new Error("Invalid announcement cursor");
    clauses.push("(date < ? OR (date = ? AND id < ?))");
    values.push(c[0], c[0], c[1]);
  }
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  return {
    sql: `SELECT id,date,payload FROM announcements ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY date DESC,id DESC LIMIT ?`,
    values: [...values, limit + 1],
    limit,
  };
}
export function passageQuery(
  ticker: string,
  question: string,
  filters: { period?: string; type?: string } = {},
  fts = true,
) {
  const clauses = ["c.ticker=?"],
    values: (string | number)[] = [ticker];
  if (filters.period) {
    if (/guidance|promise|target|outlook/i.test(question)) {
      clauses.push(
        "(d.period=? OR EXISTS (SELECT 1 FROM guidance_statements g WHERE g.document_id=d.id AND g.ticker=c.ticker AND g.page=c.page AND g.target_period=? AND g.verification_status IN ('reviewed','source_checked','verified')))",
      );
      values.push(filters.period, filters.period);
    } else {
      clauses.push("d.period=?");
      values.push(filters.period);
    }
  }
  if (filters.type) {
    clauses.push("d.type=?");
    values.push(filters.type);
  }
  const terms = retrievalTerms(question).slice(0, 45);
  if (fts && terms.length) {
    clauses.push("chunks_fts MATCH ?");
    values.push(terms.map((t) => `"${t}"`).join(" OR "));
  } else if (terms.length) {
    clauses.push(
      `(${terms.map(() => "instr(lower(c.text),?)>0").join(" OR ")})`,
    );
    values.push(...terms);
  }
  return {
    sql: `SELECT c.id,c.ticker,c.text,c.page,c.document_id,d.title,d.url,d.period,d.type FROM ${fts && terms.length ? "chunks_fts JOIN document_chunks c ON c.id=chunks_fts.chunk_id" : "document_chunks c"} JOIN documents d ON d.id=c.document_id WHERE ${clauses.join(" AND ")} ORDER BY ${fts && terms.length ? "rank," : ""} d.published_at DESC,c.page,c.id LIMIT 80`,
    values,
  };
}
export const filingByIdQuery = "SELECT payload FROM announcements WHERE id=?";
