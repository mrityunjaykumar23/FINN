// Usage: node scripts/import-local-pdf.mjs manifest.json
// Manifest: {file,ticker,url,title,type}. Original PDF only; do not export credentials.
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { getDocumentProxy, extractText } from "unpdf";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (statSync(input.file).size > 32 * 1024 * 1024)
  throw new Error("Local PDF exceeds the 32 MB administrative safeguard.");
const bytes = new Uint8Array(readFileSync(input.file));
if (new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF")
  throw new Error("Original PDF required");
const hash = createHash("sha256").update(bytes).digest("hex"),
  pdf = await getDocumentProxy(bytes, { maxImageSize: 1000000 });
if (pdf.numPages > 1000) {
  await pdf.loadingTask.destroy();
  throw new Error("Original PDF exceeds 1000 pages");
}
const extracted = await extractText(pdf, { mergePages: false });
await pdf.loadingTask.destroy();
if (extracted.text.join("").trim().length < 80)
  throw new Error(
    "No useful text extracted. Scanned original files require OCR before indexing.",
  );
const chunks = extracted.text.flatMap((page, p) => {
  const text = page
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .trim(),
    parts = [];
  for (let at = 0; at < text.length; at += 1800)
    parts.push({
      page: p + 1,
      index: parts.length,
      text: text.slice(at, at + 2000),
    });
  return parts.length ? parts : [{ page: p + 1, index: 0, text: "" }];
});
const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    }),
);
if (!vars.ADMIN_TOKEN)
  throw new Error("Configure server-side ADMIN_TOKEN first");
for (let at = 0; at < chunks.length; at += 12) {
  const r = await fetch("http://127.0.0.1:5173/api/admin/import-file-batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${vars.ADMIN_TOKEN}`,
    },
    body: JSON.stringify({
      ticker: input.ticker,
      url: input.url,
      title: input.title,
      type: input.type ?? "annual_report",
      hash,
      total_pages: extracted.totalPages,
      expected_chunks: chunks.length,
      chunks: chunks.slice(at, at + 12),
      final: at + 12 >= chunks.length,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message ?? "Import batch failed");
  console.log(
    JSON.stringify({
      completed_chunks: Math.min(at + 12, chunks.length),
      expected_chunks: chunks.length,
      ...data,
    }),
  );
  if (data.status === "already_indexed") break;
}
