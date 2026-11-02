// Operator-only QA client: credentials enter hidden stdin and remain in memory.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { categories } from "../lib/domain.ts";
let config, snapshot;
const cookies = {
  a: `finn_session=${randomUUID()}`,
  b: `finn_session=${randomUUID()}`,
};
mkdirSync(".sites-runtime/staging", { recursive: true });
async function api(
  path,
  body,
  admin = false,
  owner = "a",
  method = body ? "POST" : "GET",
) {
  assert.ok(config);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    Cookie: cookies[owner],
  };
  if (config.sitesToken)
    headers["OAI-Sites-Authorization"] = `Bearer ${config.sitesToken}`;
  if (admin) headers.Authorization = `Bearer ${config.adminToken}`;
  const r = await fetch(config.base + "/api/" + path, {
    method,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(90000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw new Error(`Non-JSON response (${r.status}) for ${path}`);
  }
  assert.equal(
    r.status,
    200,
    `${path}: ${r.status} ${JSON.stringify(d.error ?? {})}`,
  );
  return d;
}
const normal = (s) =>
  s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
async function seed() {
  await api("health");
  const before = (await api("status")).counts;
  const prepared = await api("admin/prepare-demo", {}, true);
  const after = (await api("status")).counts;
  await api("admin/prepare-demo", {}, true);
  assert.deepEqual((await api("status")).counts, after);
  assert.ok(after.documents >= 17);
  assert.ok(after.metrics >= 70);
  assert.ok(after.announcements >= 12);
  assert.equal((await api("portfolio")).companies.length, 18);
  return {
    before,
    after,
    prepared: prepared.version,
    idempotent: true,
    starter_companies: 18,
  };
}
async function full() {
  const initial = (await api("portfolio")).companies;
  assert.equal(initial.length, 18);
  const settings = await api("alerts/settings"),
    before = (await api("alerts")).alerts;
  await api(
    "alerts/settings",
    {
      ...settings,
      price_threshold: 7.5,
      min_priority: 0,
      enabled_categories: categories,
    },
    false,
    "a",
    "PUT",
  );
  assert.deepEqual(
    (await api("alerts")).alerts,
    before,
    "Settings save generated retrospective alerts",
  );
  await api("portfolio", { ticker: "ELECTCAST.NS" });
  await api("portfolio/TCS.NS", undefined, false, "a", "DELETE");
  const pa = (await api("portfolio")).companies,
    pb = (await api("portfolio", undefined, false, "b")).companies;
  assert.equal(pa.length, 18);
  assert.ok(pa.some((c) => c.ticker === "ELECTCAST.NS"));
  assert.ok(!pa.some((c) => c.ticker === "TCS.NS"));
  assert.equal(pb.length, 18);
  assert.ok(pb.some((c) => c.ticker === "TCS.NS"));
  assert.ok(!pb.some((c) => c.ticker === "ELECTCAST.NS"));
  assert.equal(
    (await api("alerts/settings", undefined, false, "b")).price_threshold,
    settings.price_threshold,
  );
  const sync = await api(
    "admin/sync-announcements",
    { tickers: ["SBIN.NS"], evaluate: false },
    true,
  );
  let filing = (await api("announcements?ticker=SBIN.NS&mode=live&limit=20"))
      .announcements[0],
    mode = "live";
  let push_method = "official SBI discovery and import";
  if (!filing) {
    const input = JSON.parse(
      readFileSync("docs/examples/infy-dividend.json", "utf8"),
    );
    const imported = await api("admin/ingest-announcements", input, true);
    filing = imported.filing;
    mode = "historical";
    push_method =
      "protected original Infosys dividend import; SBI discovery did not produce an imported event";
  }
  assert.ok(filing?.id);
  const doc = await api("documents/" + encodeURIComponent(filing.document_id));
  assert.equal(doc.ticker, filing.ticker);
  assert.match(doc.url, /^https:/);
  assert.ok(
    doc.pages.some(
      (p) =>
        p.page === filing.evidence_page &&
        normal(p.text).includes(normal(filing.event_quote)),
    ),
  );
  assert.equal(filing.publication_precision, "date");
  assert.match(filing.date_precision, /date only/i);
  const digest = await api(
    `digest?mode=${mode}&start=${filing.date}&end=${filing.date}&ticker=${encodeURIComponent(filing.ticker)}`,
  );
  assert.ok(
    [...digest.events, ...digest.routine].some((e) => e.id === filing.id),
  );
  const alerts = (await api("alerts")).alerts;
  const alert = alerts.find(
    (a) =>
      a.announcement_id === filing.id ||
      a.event_reference === filing.id ||
      a.id.endsWith(":filing:" + filing.id),
  );
  assert.ok(alert, "Authentic filing never reached owner alert");
  await api(
    "alerts/" + encodeURIComponent(alert.id),
    { status: "dismissed" },
    false,
    "a",
    "PATCH",
  );
  const question = {
    ticker: "ELECTCAST.NS",
    type: "transcript",
    period: "Q1 FY2027",
    question:
      "For ENAM evaluation, report the consolidated Q1 FY2027 total income, EBITDA and PAT from the original earnings transcript. Preserve decimals, distinguish income from revenue, and cite the primary pages.",
  };
  const answer = await api("research", question);
  assert.equal(answer.ai_status, "success");
  assert.match(answer.engine, /Gemini/);
  assert.ok(answer.model_used);
  assert.ok(answer.source_references.length);
  assert.ok(answer.metrics.some((m) => m.name === "PAT" && m.value === 48.4));
  assert.ok(
    !answer.metrics.some((m) => m.name === "Revenue" && m.value === 1465),
  );
  for (const f of answer.key_findings) {
    for (const id of f.source_ids)
      assert.ok(answer.source_references.some((s) => s.id === id));
    if (f.evidence_excerpt)
      assert.ok(
        answer.source_references.some((s) =>
          normal(s.text).includes(normal(f.evidence_excerpt)),
        ),
      );
  }
  for (const ref of answer.source_references) {
    const d = await api("documents/" + encodeURIComponent(ref.document_id));
    assert.equal(d.ticker, "ELECTCAST.NS");
    assert.ok(d.pages.some((p) => p.page === ref.page));
    assert.match(ref.url, /^https:/);
  }
  assert.equal((await api("research", question)).cached, true);
  snapshot = {
    portfolio: pa.map((c) => c.ticker).sort(),
    settings: await api("alerts/settings"),
    alert: alert.id,
    question,
    summary: answer.summary,
    counts: (await api("status")).counts,
  };
  const result = {
    passed: true,
    owner_isolation: true,
    no_retrospective_alerts_on_save: true,
    push: {
      method: push_method,
      filing_id: filing.id,
      source_url: doc.url,
      category: filing.category,
      evidence_page: filing.evidence_page,
      date: filing.date,
      source_sync: sync.announcements?.results,
    },
    pull: {
      ticker: answer.ticker,
      model: answer.model_used,
      ai_status: answer.ai_status,
      summary: answer.summary,
      metrics: answer.metrics.map((m) => ({
        name: m.name,
        value: m.value,
        period: m.period,
        page: m.page,
      })),
      citations: answer.source_references.map((s) => ({
        url: s.url,
        page: s.page,
      })),
      usage: answer.usage,
    },
    counts: snapshot.counts,
  };
  return result;
}
async function verify() {
  assert.ok(snapshot, "Run full verification in this client first");
  assert.deepEqual(
    (await api("portfolio")).companies.map((c) => c.ticker).sort(),
    snapshot.portfolio,
  );
  assert.deepEqual(await api("alerts/settings"), snapshot.settings);
  assert.equal(
    (await api("alerts")).alerts.find((a) => a.id === snapshot.alert)?.status,
    "dismissed",
  );
  const answer = await api("research", snapshot.question);
  assert.equal(answer.cached, true);
  assert.equal(answer.summary, snapshot.summary);
  const counts = (await api("status")).counts;
  for (const key of ["documents", "chunks", "metrics", "guidance"])
    assert.equal(counts[key], snapshot.counts[key]);
  return {
    passed: true,
    portfolio: true,
    preferences: true,
    dismissed_alert: true,
    cached_research: true,
    counts,
  };
}
async function scheduled(phases) {
  const result = [];
  for (const phase of phases) {
    let after, owner_after;
    for (let i = 0; i < 30; i++) {
      const response = await api(
        "jobs/scheduled",
        { phase, after, owner_after },
        !config.sitesToken,
      );
      const d = response.result;
      result.push({ phase, result: d });
      after = d.next_company_cursor ?? undefined;
      owner_after = d.next_owner_cursor ?? undefined;
      if (!after && !owner_after) break;
    }
  }
  return { steps: result.length, results: result };
}
async function command(c) {
  if (!config) {
    const url = new URL(c.base);
    assert.ok(
      (url.protocol === "https:" && url.hostname.endsWith(".chatgpt.site")) ||
        (url.protocol === "http:" && url.hostname === "127.0.0.1"),
    );
    config = c;
    console.log(JSON.stringify({ configured: true, base: c.base }));
    return;
  }
  let result;
  if (c.action === "seed") result = await seed();
  else if (c.action === "full") result = await full();
  else if (c.action === "verify") result = await verify();
  else if (c.action === "scheduled")
    result = await scheduled(
      c.phases ?? ["market", "discovery", "ingestion", "evaluate"],
    );
  else if (c.action === "request")
    result = await api(
      c.path,
      c.body,
      c.admin ?? false,
      c.owner ?? "a",
      c.method ?? (c.body ? "POST" : "GET"),
    );
  else if (c.action === "exit") {
    process.exit(0);
  } else throw new Error("Unknown action");
  const output = {
    action: c.action,
    base: config.base,
    at: new Date().toISOString(),
    result,
  };
  writeFileSync(
    `.sites-runtime/staging/${c.label ?? c.action}.json`,
    JSON.stringify(output, null, 2),
  );
  console.log(
    JSON.stringify({
      action: c.action,
      saved: `.sites-runtime/staging/${c.label ?? c.action}.json`,
      result: c.action === "scheduled" ? { steps: result.steps } : result,
    }),
  );
}
process.stdin.setRawMode?.(true);
process.stdin.resume();
let pending = "",
  chain = Promise.resolve();
console.log("Ready for private JSON on stdin (input hidden).");
process.stdin.on("data", (data) => {
  for (const ch of data.toString()) {
    if (ch === "\u0003") process.exit(0);
    if (ch === "\n" || ch === "\r") {
      if (!pending) continue;
      const line = pending;
      pending = "";
      chain = chain
        .then(() => command(JSON.parse(line)))
        .catch((e) => console.log(JSON.stringify({ error: e.message })));
    } else pending += ch;
  }
});
