import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractReportedProse } from "../lib/financial-extraction.ts";
import { quarterlyComparisons } from "../lib/periods.ts";
const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
test("new company prose extraction separates consolidated/standalone and quarterly/annual values", () => {
  const d = seed.documents.find(
      (d: { id: string }) => d.id === "dmart-results",
    ),
    r = extractReportedProse(d.pages);
  const get = (name: string, period: string, basis: string) =>
    r.metrics.find(
      (m) => m.name === name && m.period === period && m.basis === basis,
    );
  assert.equal(
    get("PAT", "Q4 FY2025", "Consolidated reported INR")?.value,
    551,
  );
  assert.equal(get("PAT", "FY2025", "Consolidated reported INR")?.value, 2707);
  assert.equal(get("PAT", "Q4 FY2025", "Standalone reported INR")?.value, 620);
  assert.equal(
    get("EBITDA", "Q4 FY2024", "Consolidated reported INR")?.value,
    944,
  );
  assert.equal(get("PBT", "Q4 FY2025", "Consolidated reported INR"), undefined);
  const rows = r.metrics.map((m, i) => ({
    ...m,
    id: String(i),
    ticker: d.ticker,
    document_id: d.id,
  }));
  const revenue = quarterlyComparisons(rows)[0];
  assert.equal(revenue.values[0]?.value, 14872);
  assert.ok(Math.abs(revenue.yoy! - (14872 / 12727 - 1) * 100) < 1e-8);
  assert.equal(revenue.qoq, null);
});
test("guidance parser obtains explicit HCLTech FY2026 range and FY2025 actual from primary pages", () => {
  const d = seed.documents.find((d: { id: string }) => d.id === "hcl-results"),
    r = extractReportedProse(d.pages);
  assert.equal(r.guidance[0].period, "FY2026");
  assert.equal(r.guidance[0].low, 2);
  assert.equal(r.guidance[0].high, 5);
  assert.equal(r.metrics.find((m) => m.name === "Revenue growth")?.value, 4.7);
  assert.equal(
    extractReportedProse([
      { page: 1, text: "Management is optimistic about revenue growth." },
    ]).guidance.length,
    0,
  );
});
