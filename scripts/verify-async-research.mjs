import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw Error("Local acceptance only");
const ticker = process.argv.find((a) => a.endsWith(".NS")) ?? "MPHASIS.NS";
const type =
  process.argv.find((a) => a.startsWith("--type="))?.split("=")[1] ??
  "transcript";
assert.ok(["transcript", "results"].includes(type));
const cookie = `finn_session=${randomUUID()}`;
const request = async (path, body) => {
  const r = await fetch(base + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
};
const started = performance.now();
const input = {
  ticker,
  type,
  question:
    type === "transcript"
      ? "Summarise the latest consolidated revenue, profitability and management outlook from the original earnings call transcript. Preserve units and decimals, do not invent missing numbers, and cite the primary pages."
      : "Summarise the latest reported revenue and profitability from the original financial results. Preserve the reporting period, accounting basis, units and decimals. Do not invent missing numbers. Cite the primary pages.",
};
let job = await request("research/jobs", input),
  creation_ms = Math.round(performance.now() - started);
const id = job.id,
  phases = [];
console.log(JSON.stringify({ created: true, ticker, creation_ms, id }));
for (let i = 0; i < 160 && job.status !== "complete"; i++) {
  assert.notEqual(job.status, "failed", job.error);
  const previous = phases.at(-1);
  if (
    !previous ||
    previous.phase !== job.phase ||
    previous.status !== job.status
  ) {
    phases.push({
      phase: job.phase,
      status: job.status,
      elapsed_ms: Math.round(performance.now() - started),
      detail: job.detail,
    });
    console.log(JSON.stringify(phases.at(-1)));
  }
  if (
    job.status === "queued" ||
    Date.now() - Date.parse(job.updated_at) > 90000
  )
    await request(`research/jobs/${id}/advance`, {});
  await new Promise((r) => setTimeout(r, 1500));
  job = await request(`research/jobs/${id}`);
}
assert.equal(job.status, "complete", JSON.stringify(job));
mkdirSync(".sites-runtime/redesign", { recursive: true });
writeFileSync(
  `.sites-runtime/redesign/research-${ticker}.json`,
  JSON.stringify(
    {
      ticker,
      creation_ms,
      total_ms: Math.round(performance.now() - started),
      phases,
      job,
    },
    null,
    2,
  ),
);
assert.equal(job.result.ticker, ticker);
assert.equal(
  job.result.ai_status,
  "success",
  "A fallback is not a real Gemini acceptance pass",
);
assert.ok(job.result.source_references.length > 0);
if (type === "results" || process.argv.includes("--require-financial")) {
  assert.ok(
    job.result.metrics.length > 0,
    "Financial PULL requires accepted source-checked metrics, not a call invitation",
  );
  assert.equal(
    job.document?.status,
    "complete",
    "Financial extraction must actually complete",
  );
}
const normal = (s) =>
  s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
for (const source of job.result.source_references) {
  const original = await request(
    "documents/" + encodeURIComponent(source.document_id),
  );
  assert.equal(original.ticker, ticker);
  assert.equal(
    new URL(source.url).origin +
      new URL(source.url).pathname +
      new URL(source.url).search,
    new URL(original.url).origin +
      new URL(original.url).pathname +
      new URL(original.url).search,
  );
  const page = original.pages.find((p) => p.page === source.page);
  assert.ok(
    page && normal(page.text).includes(normal(source.text)),
    "Retrieved passage must occur on its original primary page",
  );
}
for (const f of [
  ...job.result.key_findings,
  ...(job.result.management_commentary ?? []),
  ...(job.result.risks ?? []),
  ...(job.result.positive_factors ?? []),
]) {
  assert.ok(
    f.source_ids.every((id) =>
      job.result.source_references.some((s) => s.id === id),
    ),
  );
  if (f.evidence_excerpt)
    assert.ok(
      f.source_ids.some((id) => {
        const s = job.result.source_references.find((s) => s.id === id);
        return s && normal(s.text).includes(normal(f.evidence_excerpt));
      }),
      "Original excerpt must match a cited primary page",
    );
}
const cached = await request("research", input);
assert.equal(cached.cached, true);
assert.equal(cached.summary, job.result.summary);
const result = {
  passed: true,
  ticker,
  id,
  creation_ms,
  total_ms: Math.round(performance.now() - started),
  phases,
  result: job.result,
  cached: true,
};
mkdirSync(".sites-runtime/redesign", { recursive: true });
writeFileSync(
  ".sites-runtime/redesign/cold-research.json",
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    passed: true,
    ticker,
    creation_ms,
    total_ms: result.total_ms,
    model: job.result.model_used,
    citations: job.result.source_references.map((s) => ({
      url: s.url,
      page: s.page,
    })),
    summary: job.result.summary,
    cached: true,
  }),
);
if (process.argv.includes("--hold")) {
  console.log("Ready for persistence verification on stdin.");
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", async (text) => {
    if (text.trim() === "verify") {
      try {
        const persisted = await request(`research/jobs/${id}`);
        assert.equal(persisted.status, "complete");
        assert.equal(persisted.result.summary, job.result.summary);
        console.log(JSON.stringify({ restart_persistence: true, id }));
        writeFileSync(
          ".sites-runtime/redesign/research-restart.json",
          JSON.stringify({ passed: true, id, at: new Date().toISOString() }),
        );
      } catch (e) {
        console.error(e);
        process.exitCode = 1;
      }
    } else if (text.trim() === "exit") process.exit();
  });
}
