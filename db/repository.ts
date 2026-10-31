import { env } from "cloudflare:workers";

/** The only runtime-specific SQL boundary. SQL repositories use this SQLite contract. */
export const db = () => {
  if (!env.DB)
    throw new Error("SQLite binding unavailable. Run local migrations.");
  return env.DB;
};
export type SqlValue = string | number | null;
export const all = async <T>(sql: string, ...values: SqlValue[]) =>
  (
    await db()
      .prepare(sql)
      .bind(...values)
      .all<T>()
  ).results;
export const one = async <T>(sql: string, ...values: SqlValue[]) =>
  db()
    .prepare(sql)
    .bind(...values)
    .first<T>();
export const run = async (sql: string, ...values: SqlValue[]) =>
  db()
    .prepare(sql)
    .bind(...values)
    .run();
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const sha = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

/** Atomic UPDATE prevents concurrent requests from exceeding persisted budgets. */
export async function budget(scope: string, limit: number, windowMs = 3600000) {
  const bucket = String(Math.floor(Date.now() / windowMs));
  await run(
    "INSERT OR IGNORE INTO request_budgets(scope,bucket,used) VALUES (?,?,0)",
    scope,
    bucket,
  );
  const result = await run(
    "UPDATE request_budgets SET used=used+1 WHERE scope=? AND bucket=? AND used<?",
    scope,
    bucket,
    limit,
  );
  if (!result.meta.changes)
    throw new ApiError(
      429,
      "request_budget",
      "Request budget reached. Try again after the current window.",
    );
}
export async function lock(key: string, ms = 180000) {
  const now = new Date().toISOString();
  const result = await run(
    "INSERT INTO job_locks(key,expires_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE job_locks.expires_at<?",
    key,
    new Date(Date.now() + ms).toISOString(),
    now,
  );
  return !!result.meta.changes;
}
export const unlock = (key: string) =>
  run("DELETE FROM job_locks WHERE key=?", key);
