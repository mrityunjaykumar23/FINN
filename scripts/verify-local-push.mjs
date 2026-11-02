import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw Error("Local verification only");
const cookie = `finn_session=${randomUUID()}`;
async function api(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const settings = await api("alerts/settings"),
  before = (await api("alerts")).alerts;
await api("alerts/settings", { ...settings, min_priority: 0 }, "PUT");
assert.deepEqual((await api("alerts")).alerts, before);
const normal = (s) =>
  s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const result = [];
for (const ticker of ["ITC.NS", "SBIN.NS", "NTPC.NS"]) {
  const filings = (
    await api(`announcements?ticker=${ticker}&mode=live&limit=20`)
  ).announcements;
  assert.ok(filings.length, `${ticker} has no authentic stored event`);
  const f = filings[0],
    doc = await api("documents/" + encodeURIComponent(f.document_id));
  assert.equal(doc.ticker, ticker);
  assert.match(doc.url, /^https:/);
  const page = doc.pages.find((p) => p.page === f.evidence_page);
  assert.ok(page && normal(page.text).includes(normal(f.event_quote)));
  const digest = await api(
    `digest?mode=live&start=${f.date}&end=${f.date}&ticker=${ticker}`,
  );
  assert.ok([...digest.events, ...digest.routine].some((e) => e.id === f.id));
  const detail = await api("announcements/" + encodeURIComponent(f.id));
  assert.ok(detail.score >= 0);
  assert.ok(detail.category);
  assert.equal(detail.source_url, doc.url);
  result.push({
    ticker,
    id: f.id,
    date: f.date,
    precision: f.publication_precision,
    category: detail.category,
    score: detail.score,
    source: doc.url,
    page: f.evidence_page,
  });
}
const alerts = (await api("alerts")).alerts;
const itc = result.find((x) => x.ticker === "ITC.NS");
const alert = alerts.find(
  (a) =>
    a.announcement_id === itc.id ||
    a.event_reference === itc.id ||
    a.id.endsWith(":filing:" + itc.id),
);
assert.ok(alert, "New ITC filing did not reach a current owner alert");
await api(
  "alerts/" + encodeURIComponent(alert.id),
  { status: "dismissed" },
  "PATCH",
);
await api("alerts/evaluate", {});
assert.equal(
  (await api("alerts")).alerts.find((a) => a.id === alert.id).status,
  "dismissed",
);
mkdirSync(".sites-runtime/redesign", { recursive: true });
writeFileSync(
  ".sites-runtime/redesign/push.json",
  JSON.stringify(
    { passed: true, result, alert_dismissal_persisted: true },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ passed: true, result, alert_dismissal_persisted: true }),
);
