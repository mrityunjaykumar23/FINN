import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw Error("Local persistence verification only");
const cookie = `finn_session=${randomUUID()}`;
async function api(path, body, method = body ? "POST" : "GET", owner = cookie) {
  const response = await fetch(base + "/api/" + path, {
    method,
    headers: { Cookie: owner, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
const original = (await api("portfolio")).companies;
assert.equal(original.length, 18);
await api("portfolio", { ticker: "DMART.NS" });
const settings = await api("alerts/settings");
const alerts = (await api("alerts")).alerts;
await api("alerts/settings", { ...settings, price_threshold: 4 }, "PUT");
assert.deepEqual((await api("alerts")).alerts, alerts);
const job = await api("research/jobs", {
  ticker: "INFY.NS",
  question: "Verify original FY2025 revenue evidence after a process restart.",
  period: "FY2025",
});
assert.equal(job.status, "queued");
console.log(
  "Prepared isolated visitor data. Send verify after restarting localhost.",
);
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", async (input) => {
  if (input.trim() === "verify") {
    try {
      const portfolio = (await api("portfolio")).companies;
      assert.equal(portfolio.length, 19);
      assert.ok(portfolio.some((c) => c.ticker === "DMART.NS"));
      assert.equal((await api("alerts/settings")).price_threshold, 4);
      assert.equal((await api(`research/jobs/${job.id}`)).status, "queued");
      assert.deepEqual((await api("alerts")).alerts, alerts);
      const other = `finn_session=${randomUUID()}`;
      assert.equal(
        (await api("portfolio", null, "GET", other)).companies.length,
        18,
      );
      const denied = await fetch(base + `/api/research/jobs/${job.id}`, {
        headers: { Cookie: other },
      });
      assert.equal(denied.status, 404);
      await api("portfolio/DMART.NS", null, "DELETE");
      await api("alerts/settings", settings, "PUT");
      const result = {
        passed: true,
        portfolio_persisted: true,
        settings_persisted: true,
        queued_research_persisted: true,
        unchanged_alert_history: true,
        owner_isolation: true,
        isolated_test_portfolio_restored: true,
      };
      mkdirSync("docs/test-results", { recursive: true });
      writeFileSync(
        "docs/test-results/redesign-restart.json",
        JSON.stringify(result, null, 2) + "\n",
      );
      console.log(JSON.stringify(result));
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }
});
