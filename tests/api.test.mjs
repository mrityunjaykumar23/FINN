import test from "node:test";
import assert from "node:assert/strict";
const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
// A dedicated device identity keeps integration tests separate from the browser portfolio.
const cookie = "finn_session=00000000-0000-4000-8000-000000000001";
async function request(path, method = "GET", body) {
  const r = await fetch(`${base}/api/${path}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json() };
}
test("health, persisted portfolio, and authentic daily observations", async () => {
  assert.equal((await request("health")).status, 200);
  const { data } = await request("portfolio");
  assert.equal(data.companies.length, 18);
  assert.ok(
    data.companies.every((c) => c.close > 0 && c.date === "2025-04-22"),
  );
  assert.equal((await request("market/INFY.NS")).data.points.length, 32);
});
test("search inside and outside the portfolio is not coupled to watchlist membership", async () => {
  for (const q of ["TCS", "ASIANPAINT", "PERSISTENT", "DMART"]) {
    const { status, data } = await request(`companies/search?q=${q}`);
    assert.equal(status, 200);
    assert.ok(data.companies.some((c) => c.ticker === `${q}.NS`));
  }
});
test("add/remove is persistent and idempotent", async () => {
  try {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await request("portfolio", "POST", { ticker: "ASIANPAINT.NS" }))
          .status,
        200,
      );
    const p = await request("portfolio");
    assert.equal(
      p.data.companies.filter((c) => c.ticker === "ASIANPAINT.NS").length,
      1,
    );
  } finally {
    await request("portfolio/ASIANPAINT.NS", "DELETE");
  }
  assert.equal((await request("portfolio")).data.companies.length, 18);
});
test("windowed digest separates material filings and lower-priority source context", async () => {
  const { data } = await request("digest?days=7");
  assert.equal(data.events.length, 2);
  assert.equal(data.routine.length, 2);
  assert.equal(data.covered_companies, 2);
  assert.ok(data.market_alerts.length > 0);
  assert.equal(
    (await request("digest?start=2025-02-01&end=2025-02-02")).data.events
      .length,
    0,
  );
  assert.equal(
    (await request("digest?days=7&ticker=INFY.NS&category=results")).data.events
      .length,
    1,
  );
  const event = await request("announcements/infy-fy25-results");
  assert.equal(event.status, 200);
  assert.ok(event.data.source_url.startsWith("https://www.infosys.com/"));
  assert.ok(event.data.evidence_text.includes("4.2%"));
});
test("stored alert settings change the evaluation of real EOD observations", async () => {
  const initial = (await request("alerts/settings")).data;
  try {
    const next = { ...initial, price_threshold: 0.1, volume_multiplier: 1 };
    assert.equal((await request("alerts/settings", "PUT", next)).status, 200);
    assert.equal((await request("alerts/settings")).data.price_threshold, 0.1);
    const alerts = (await request("digest?days=1")).data.market_alerts;
    assert.ok(alerts.length > 1);
    assert.ok((await request("alerts")).data.alerts.length > 0);
  } finally {
    await request("alerts/settings", "PUT", initial);
  }
});
test("research cites actual primary documents and excludes cross-company passages", async () => {
  for (const ticker of [
    "INFY.NS",
    "ASIANPAINT.NS",
    "PERSISTENT.NS",
    "DMART.NS",
  ]) {
    const { status, data } = await request("research", "POST", {
      ticker,
      question: "What does the annual report say about revenue and cash flow?",
    });
    assert.equal(status, 200);
    assert.ok(data.source_references.length > 0, ticker);
    const docs = (await request(`research/${ticker}/documents`)).data.documents;
    for (const source of data.source_references) {
      assert.ok(
        docs.some((d) => d.id === source.document_id && d.ticker === ticker),
      );
      assert.ok(source.page > 0);
      assert.ok(new URL(source.url).protocol === "https:");
    }
    assert.match(data.engine, /Source retrieval|Deterministic calculation/);
  }
});
test("a missing passage produces neither a company conclusion nor a fake citation", async () => {
  const { data } = await request("research", "POST", {
    ticker: "INFY.NS",
    question: "xyzzymissingteleportation",
  });
  assert.equal(data.source_references.length, 0);
  assert.equal(data.key_findings.length, 0);
  assert.match(data.summary, /Insufficient source evidence/);
});
test("guidance links both matching-period sources and computes the miss", async () => {
  const { data } = await request("research/INFY.NS/guidance");
  assert.equal(data.comparisons.length, 2);
  const revenue = data.comparisons[0];
  assert.equal(revenue.status, "Below guidance");
  assert.ok(Math.abs(revenue.variance + 0.3) < 1e-8);
  assert.equal(revenue.sources.length, 2);
  assert.ok(revenue.sources.every((s) => s.url && s.page));
  assert.equal(
    (await request("research/ASIANPAINT.NS/guidance")).data.comparisons.length,
    0,
  );
});
test("validation, missing evidence, and protected ingestion return structured errors", async () => {
  for (const [path, method, body, status] of [
    ["admin/ingest-market", "POST", { ticker: "INFY.NS" }, 403],
    ["admin/ingest-announcements", "POST", {}, 403],
    ["research", "POST", { ticker: "bad/ticker", question: "cash" }, 422],
    ["research", "POST", { ticker: "INFY.NS", question: "a" }, 422],
    ["announcements/missing", "GET", null, 404],
    ["documents/missing", "GET", null, 404],
    ["digest?days=nope", "GET", null, 422],
    ["digest?start=2025-02-31", "GET", null, 422],
    ["alerts/settings", "PUT", { price_threshold: -4 }, 422],
  ]) {
    const r = await request(path, method, body);
    assert.equal(r.status, status, `${path}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.error?.code && r.data.error?.message);
  }
});
