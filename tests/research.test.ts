import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateFindings } from "../lib/research-analysis.ts";
const seed = JSON.parse(
  readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"),
);
test("offline revenue analysis calculates from aligned reported INR values", () => {
  const result = calculateFindings(
    "INFY.NS",
    "How has revenue growth changed?",
    seed.metrics,
    seed.guidance,
  );
  assert.equal(result.length, 2);
  assert.ok(result[0].text.includes("down 2.01%"));
  assert.ok(result[1].text.includes("up 7.92%"));
  assert.ok(result.every((f) => f.sources.length === 2));
});
test("cash conversion states the precise profit definition and calculation basis", () => {
  const result = calculateFindings(
    "HCLTECH.NS",
    "Does cash flow support profitability?",
    seed.metrics,
    seed.guidance,
  );
  assert.ok(result[0].text.includes("128.0%"));
  assert.ok(result[0].text.includes("attributable PAT"));
  assert.ok(result[0].text.includes("consolidated INR"));
});
test("incompatible accounting bases cannot generate a combined financial claim", () => {
  const altered = seed.metrics.map((m: { name: string; basis: string }) =>
    m.name === "PAT" ? { ...m, basis: "Standalone IFRS" } : m,
  );
  const result = calculateFindings(
    "INFY.NS",
    "cash conversion",
    altered,
    seed.guidance,
  );
  assert.equal(result.length, 0);
});
test("missing company metrics do not become fabricated offline findings", () => {
  assert.equal(
    calculateFindings(
      "UNKNOWN.NS",
      "cash and revenue growth",
      seed.metrics,
      seed.guidance,
    ).length,
    0,
  );
});
test("guidance answers preserve both original and result citations", () => {
  const result = calculateFindings(
    "INFY.NS",
    "Did management deliver on revenue guidance?",
    seed.metrics,
    seed.guidance,
  );
  assert.equal(result.length, 1);
  assert.ok(result[0].text.includes("0.3 percentage points below"));
  assert.deepEqual(result[0].sources, [
    { document_id: "infy-call-q3", page: 7 },
    { document_id: "infy-results", page: 1 },
  ]);
});
