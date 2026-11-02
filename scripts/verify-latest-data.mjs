import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw Error("Local acceptance only");
const cookie = `finn_session=${randomUUID()}`;
async function api(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const result = { market: null, financial: [] };
await api("portfolio", { ticker: "JPL.NS" });
let market;
for (let i = 0; i < 20; i++) {
  market = (await api("portfolio?mode=live")).companies.find(
    (c) => c.ticker === "JPL.NS",
  );
  if (!market.market_freshness?.refreshing) break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(market);
assert.ok(market.date && market.date >= "2026-10-28");
assert.ok(market.close > 0);
assert.equal(market.relative_volume, null);
const replay = (await api("portfolio?mode=historical")).companies.find(
  (c) => c.ticker === "JPL.NS",
);
assert.equal(replay.close, null);
assert.equal(replay.date, null);
const prices = (await api("market/JPL.NS?mode=live")).points;
assert.ok(prices.every((p) => p.date >= "2026-10-28"));
if (prices.length >= 2) {
  const a = prices.at(-1),
    b = prices.at(-2);
  assert.ok(
    Math.abs(market.change - (a.adjusted_close / b.adjusted_close - 1) * 100) <
      1e-9,
  );
} else assert.equal(market.change, null);
result.market = {
  passed: true,
  latest: market.date,
  close: market.close,
  sessions: prices.length,
  change: market.change,
  relative_volume: market.relative_volume,
  history_limitation:
    prices.length < 2
      ? "Provider supplied fewer than two verified daily observations; change is unavailable."
      : null,
};
console.log(JSON.stringify(result.market));
for (const ticker of process.argv.includes("--jpl-only")
  ? ["JPL.NS"]
  : ["JPL.NS", "INFY.NS", "DABUR.NS"]) {
  await api("portfolio", { ticker });
  let company;
  for (let i = 0; i < 25; i++) {
    company = (await api("portfolio?mode=live")).companies.find(
      (c) => c.ticker === ticker,
    );
    if (!company.market_freshness?.refreshing) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const marketPoints = (await api(`market/${ticker}?mode=live`)).points;
  assert.ok(company.close > 0);
  assert.ok(marketPoints.length > 0);
  assert.ok(marketPoints.every((p) => p.date !== "2025-04-22"));
  const [last, previous] = [marketPoints.at(-1), marketPoints.at(-2)];
  if (
    last.adjusted_close === null ||
    !previous ||
    previous.adjusted_close === null
  )
    assert.equal(company.change, null);
  else
    assert.ok(
      Math.abs(
        company.change -
          (last.adjusted_close / previous.adjusted_close - 1) * 100,
      ) < 1e-9,
    );
  console.log(
    JSON.stringify({
      ticker,
      market: {
        date: company.date,
        close: company.close,
        change: company.change,
        relative_volume: company.relative_volume,
        sessions: marketPoints.length,
        latest_adjusted_close: last.adjusted_close,
      },
    }),
  );
  const before = await api(`companies/${ticker}/overview?mode=live`),
    started = Date.now();
  let state = await api(`companies/${ticker}/snapshot`, {
    force: process.argv.includes("--force"),
  });
  const creation_ms = Date.now() - started;
  let previousPhase = "";
  for (
    let i = 0;
    i < 140 && ["queued", "running"].includes(state.status);
    i++
  ) {
    const label = state.phase + ":" + state.status;
    if (label !== previousPhase) {
      console.log(
        JSON.stringify({
          ticker,
          phase: state.phase,
          status: state.status,
          elapsed_ms: Date.now() - started,
          detail: state.detail,
        }),
      );
      previousPhase = label;
    }
    if (
      state.status === "queued" ||
      Date.now() - Date.parse(state.updated_at) > 90000
    )
      await api(`companies/${ticker}/snapshot/advance`, {});
    await new Promise((r) => setTimeout(r, 1000));
    state = await api(`companies/${ticker}/snapshot`);
  }
  const output = {
    ticker,
    market: {
      date: company.date,
      close: company.close,
      change: company.change,
      relative_volume: company.relative_volume,
      sessions: marketPoints.length,
      latest_adjusted_close: last.adjusted_close,
    },
    before: {
      documents: before.documents.length,
      metrics: before.metrics.length,
    },
    creation_ms,
    total_ms: Date.now() - started,
    status: state.status,
    error: state.error,
    period: state.period,
    statuses: state.statuses,
    financial_errors: state.financial_errors,
    documents: state.documents,
  };
  result.financial.push(output);
  mkdirSync(".sites-runtime/latest-data", { recursive: true });
  writeFileSync(
    ".sites-runtime/latest-data/acceptance.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      ticker,
      status: state.status,
      period: state.period,
      metrics: state.statuses.map((s) => ({
        name: s.name,
        state: s.state,
        value: s.metric?.value,
      })),
      errors: state.financial_errors,
    }),
  );
  assert.equal(state.status, "complete", JSON.stringify(output));
  assert.ok(
    state.statuses.filter((s) => s.metric).length >= 3,
    "At least revenue and reported profit facts must be accepted from an original source",
  );
  if (ticker === "INFY.NS") assert.equal(state.period, "Q2 FY2027");
  if (ticker === "JPL.NS") {
    assert.equal(state.period, "Q2 FY2027");
    const expected = { Revenue: 40475, EBITDA: 21879, PBT: 11259, PAT: 8387 };
    for (const [name, value] of Object.entries(expected))
      assert.equal(
        state.statuses.find((s) => s.name === name)?.metric?.value,
        value,
      );
    const half = await api(
      `companies/${ticker}/snapshot?period=${encodeURIComponent("H1 FY2027")}`,
    );
    assert.equal(
      half.statuses.find((s) => s.name === "Revenue").metric.value,
      79648,
    );
  }
  for (const row of state.statuses.filter((s) => s.metric)) {
    const m = row.metric,
      d = await api("documents/" + m.document_id),
      p = d.pages.find((p) => p.page === m.page);
    assert.equal(d.ticker, ticker);
    assert.ok(p);
    assert.ok(
      p.text
        .replace(/\s+/g, " ")
        .includes(m.evidence_text.replace(/\s+/g, " ")),
    );
    assert.match(d.url, /^https:/);
  }
}
result.passed = true;
writeFileSync(
  ".sites-runtime/latest-data/acceptance.json",
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    passed: true,
    companies: result.financial.map((f) => f.ticker),
  }),
);
