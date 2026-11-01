import { db, one, ApiError } from "../../db/repository";
import { safeSourceUrl } from "../server";
import sources from "../../data/announcement-sources.json";
import { inferHeaderPeriod } from "../financial-extraction";
export type FileBatch = {
  ticker: string;
  url: string;
  title: string;
  hash: string;
  total_pages: number;
  expected_chunks: number;
  type: string;
  chunks: { page: number; index: number; text: string }[];
  final: boolean;
};
/** Protected administrative import of an original PDF already downloaded legitimately.
 * The CLI hashes the actual file. Batches are idempotent; interrupted imports stay indexing. */
export async function importFileBatch(input: FileBatch) {
  const company = await one<{ name: string }>(
    "SELECT name FROM companies WHERE ticker=?",
    input.ticker,
  );
  if (!company)
    throw new ApiError(
      422,
      "company_missing",
      "Resolve the company before importing its original file.",
    );
  const trusted = await one<{ url: string }>(
    "SELECT url FROM documents WHERE ticker=? ORDER BY retrieved_at DESC LIMIT 1",
    input.ticker,
  );
  const host =
    sources.find((s) => s.ticker === input.ticker)?.officialHost ??
    (trusted ? new URL(trusted.url).hostname.replace(/^www\./, "") : undefined);
  if (!safeSourceUrl(input.url, host))
    throw new ApiError(
      422,
      "source_not_allowed",
      "Use a verified original exchange/company URL for the downloaded file.",
    );
  const existing = await one<{
    id: string;
    ticker: string;
    extraction_status: string;
  }>(
    "SELECT id,ticker,extraction_status FROM documents WHERE hash=?",
    input.hash,
  );
  if (existing && existing.ticker !== input.ticker)
    throw new ApiError(
      422,
      "document_company_conflict",
      "The PDF hash belongs to another company.",
    );
  if (existing?.extraction_status === "complete") {
    const coverage = await one<{ n: number }>(
      "SELECT count(DISTINCT page) n FROM document_chunks WHERE document_id=? AND length(trim(text))>0",
      existing.id,
    );
    if (coverage?.n === input.total_pages)
      return { id: existing.id, status: "already_indexed" };
  }
  const id = existing?.id ?? `live-${input.hash.slice(0, 20)}`;
  if (!existing) {
    const clean = (s: string) =>
      s.toLowerCase().replace(/limited|ltd|[^a-z0-9]/g, "");
    const first = clean(input.chunks.map((c) => c.text).join(" "));
    if (
      !first.includes(clean(input.ticker.replace(/\.(NS|BO)$/, ""))) &&
      !first.includes(clean(company.name))
    )
      throw new ApiError(
        422,
        "document_company_unverified",
        "The first import batch must contain the original company identity.",
      );
  }
  if (input.chunks.some((c) => c.page > input.total_pages))
    throw new ApiError(
      422,
      "invalid_page",
      "Chunk page exceeds the original PDF page count.",
    );
  const now = new Date().toISOString(),
    period = inferHeaderPeriod(
      input.chunks.map((c) => ({ page: c.page, text: c.text })),
    );
  const statements = [
    db()
      .prepare(
        "INSERT OR IGNORE INTO documents(id,ticker,title,type,period,url,published_at,retrieved_at,hash,mode,publisher,extraction_status,total_pages,indexed_pages) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        input.ticker,
        input.title,
        input.type,
        period ?? "Period not verified",
        input.url,
        null,
        now,
        input.hash,
        "live",
        new URL(input.url).hostname,
        "indexing",
        input.total_pages,
        0,
      ),
    ...input.chunks.map((c) =>
      db()
        .prepare(
          "INSERT OR IGNORE INTO document_chunks(id,document_id,ticker,page,text) VALUES (?,?,?,?,?)",
        )
        .bind(`${id}:${c.page}:${c.index}`, id, input.ticker, c.page, c.text),
    ),
    db()
      .prepare(
        "UPDATE documents SET indexed_pages=(SELECT count(DISTINCT page) FROM document_chunks WHERE document_id=? AND length(trim(text))>0),extraction_status=CASE WHEN ?=1 AND (SELECT count(*) FROM document_chunks WHERE document_id=?)=? THEN CASE WHEN (SELECT count(DISTINCT page) FROM document_chunks WHERE document_id=? AND length(trim(text))>0)=total_pages THEN 'complete' ELSE 'partial' END ELSE 'indexing' END WHERE id=?",
      )
      .bind(id, input.final ? 1 : 0, id, input.expected_chunks, id, id),
  ];
  await db().batch(statements);
  return {
    ...(await one<{
      id: string;
      extraction_status: string;
      indexed_pages: number;
      total_pages: number;
    }>(
      "SELECT id,extraction_status,indexed_pages,total_pages FROM documents WHERE id=?",
      id,
    )),
    original_file_hash: input.hash,
  };
}
