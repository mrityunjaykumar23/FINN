import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = process.env.FINN_DEMO_TEST_URL;
const config = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    }),
);
test(
  "empty migrated localhost becomes an idempotent authentic demo with the original 18-company portfolio",
  {
    skip: !base
      ? "Set FINN_DEMO_TEST_URL to an empty isolated localhost database"
      : false,
  },
  async () => {
    assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
    let cookie = "";
    async function api(path, input, admin = false) {
      const r = await fetch(base + "/api/" + path, {
        method: input ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          ...(admin ? { Authorization: `Bearer ${config.ADMIN_TOKEN}` } : {}),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      const d = await r.json();
      assert.equal(r.status, 200, JSON.stringify(d));
      return d;
    }
    await api("health");
    const before = await api("status");
    assert.equal(
      before.counts.documents,
      11,
      "Requires a fresh DB; never deletes user records.",
    );
    assert.equal((await api("portfolio")).companies.length, 18);
    const result = await api("admin/prepare-demo", {}, true);
    assert.equal(result.documents, 6);
    const after = await api("status");
    assert.equal(after.counts.documents, 17);
    assert.equal(after.counts.announcements, before.counts.announcements + 8);
    await api("admin/prepare-demo", {}, true);
    assert.deepEqual((await api("status")).counts, after.counts);
    assert.equal((await api("portfolio")).companies.length, 18);
    const guidance = (
      await api("research/HCLTECH.NS/guidance")
    ).comparisons.filter(
      (g) => g.period === "FY2025" && g.metric === "Revenue growth",
    );
    assert.equal(guidance.length, 2);
    assert.ok(
      guidance.some((g) => g.superseded && g.low === 3 && g.high === 5),
    );
    assert.ok(guidance.some((g) => g.revised && g.actual === 4.7));
    const digest = await api(
      "digest?mode=live&start=2026-10-01&end=2026-10-31",
    );
    assert.ok(
      digest.events.some(
        (e) => e.ticker === "NTPC.NS" && e.category === "capex",
      ),
    );
    assert.equal(
      digest.successfully_checked_companies,
      0,
      "Bundled events never fabricate monitoring success.",
    );
    const overview = await api("companies/DMART.NS/overview");
    assert.ok(
      overview.metrics.some(
        (m) => m.period === "Q3 FY2025" && m.name === "Revenue",
      ),
    );
    assert.ok(
      overview.metrics.some(
        (m) => m.period === "Q4 FY2025" && m.name === "Revenue",
      ),
    );
  },
);
