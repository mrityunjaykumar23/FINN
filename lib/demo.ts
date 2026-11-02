import bundle from "../data/demo-evidence.json";
import { db, one, run, ApiError } from "../db/repository";
import { persistFiling } from "./workflows";
import type { Filing } from "./domain";
/** Fixed repository-owned primary evidence only. No request-supplied SQL/data, no owner records. */
export async function prepareDemo() {
  const insert = (table: string, row: Record<string, unknown>) =>
    db()
      .prepare(
        `INSERT OR IGNORE INTO ${table}(${Object.keys(row).join(",")}) VALUES (${Object.keys(
          row,
        )
          .map(() => "?")
          .join(",")})`,
      )
      .bind(...Object.values(row));
  for (const d of bundle.documents) {
    const existing = await one<{ ticker: string }>(
      "SELECT ticker FROM documents WHERE id=? OR hash=?",
      d.id,
      d.hash,
    );
    if (existing && existing.ticker !== d.ticker)
      throw new ApiError(
        409,
        "demo_conflict",
        "Existing document belongs to another company. No data was replaced.",
      );
    const chunks = bundle.chunks.filter((c) => c.document_id === d.id);
    // Chunk coverage and original total page count remain explicit (rating report is partial).
    const statements = [
      insert("documents", d),
      ...chunks.map((c) => insert("document_chunks", c)),
    ];
    for (let i = 0; i < statements.length; i += 50)
      await db().batch(statements.slice(i, i + 50));
  }
  for (const row of bundle.metrics)
    await db().batch([insert("financial_metrics", row)]);
  for (const row of bundle.guidance)
    await db().batch([insert("guidance_statements", row)]);
  for (const e of bundle.events) {
    if (await one("SELECT id FROM announcements WHERE id=?", e.filing.id))
      continue;
    await persistFiling(e.filing as Filing, e.mode, "reviewed_demo");
  }
  await run(
    "INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)",
    bundle.version,
    new Date().toISOString(),
  );
  return {
    version: bundle.version,
    documents: bundle.documents.length,
    metrics: bundle.metrics.length,
    guidance: bundle.guidance.length,
    events: bundle.events.length,
    note: bundle.note,
  };
}
