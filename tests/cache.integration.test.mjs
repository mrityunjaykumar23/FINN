import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = process.env.FINN_CACHE_TEST_URL;
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
  "real HTTP answer cache invalidates after newly imported HCL guidance and survives unrelated Infosys ingestion",
  {
    skip: !base
      ? "Set FINN_CACHE_TEST_URL to a fresh isolated localhost acceptance database"
      : false,
  },
  async () => {
    assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
    async function api(path, input, admin = false) {
      const r = await fetch(base + "/api/" + path, {
        method: input ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(admin ? { Authorization: `Bearer ${config.ADMIN_TOKEN}` } : {}),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      const data = await r.json();
      assert.equal(r.status, 200, JSON.stringify(data));
      return data;
    }
    await api("health");
    assert.ok(
      !(await api("research/HCLTECH.NS/guidance")).comparisons.some(
        (g) => g.period === "FY2025",
      ),
      "This acceptance test requires a fresh database; it never clears guidance.",
    );
    const query = {
      ticker: "HCLTECH.NS",
      question:
        "Compare HCLTech FY2025 revenue growth guidance with reported FY2025 constant-currency revenue growth.",
      period: "FY2025",
    };
    const first = await api("research", query);
    assert.equal(first.ai_status, "success");
    assert.ok(!first.cached);
    assert.equal((await api("research", query)).cached, true);
    await api(
      "admin/ingest-announcements",
      JSON.parse(readFileSync("docs/examples/hcl-q3fy25.json", "utf8")),
      true,
    );
    const guidance = (await api("research/HCLTECH.NS/guidance")).comparisons;
    assert.ok(
      guidance.some(
        (g) => g.period === "FY2025" && g.low === 4.5 && g.high === 5,
      ),
    );
    const refreshed = await api("research", query);
    assert.ok(!refreshed.cached);
    assert.equal(refreshed.ai_status, "success");
    assert.match(JSON.stringify(refreshed), /4\.5/);
    assert.equal((await api("research", query)).cached, true);
    await api(
      "admin/ingest-announcements",
      JSON.parse(readFileSync("docs/examples/infy-dividend.json", "utf8")),
      true,
    );
    assert.equal((await api("research", query)).cached, true);
  },
);
