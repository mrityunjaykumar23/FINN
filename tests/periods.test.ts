import test from "node:test";
import assert from "node:assert/strict";
import { comparisonPeriods, quarterlyComparisons } from "../lib/periods.ts";
import { calculateFindings } from "../lib/research-analysis.ts";
import { compareGuidance, type Metric } from "../lib/domain.ts";
const row = (
  period: string,
  value: number,
  basis = "Consolidated Ind AS",
  unit = "INR crore",
): Metric => ({
  id: period,
  ticker: "NEWCO.NS",
  name: "Revenue",
  period,
  value,
  basis,
  unit,
  document_id: "isolated-test-evidence",
  page: 1,
});
test("latest dynamic quarter, prior quarter and prior-year quarter cross fiscal boundaries", () => {
  const rows = [
    row("Q1 FY2027", 110),
    row("Q4 FY2026", 100),
    row("Q1 FY2026", 80),
  ];
  assert.deepEqual(comparisonPeriods(rows), [
    "Q1 FY2027",
    "Q4 FY2026",
    "Q1 FY2026",
  ]);
  const c = quarterlyComparisons(rows)[0];
  assert.equal(Math.round(c.qoq!), 10);
  assert.equal(c.yoy, 37.5);
  assert.ok(
    calculateFindings("NEWCO.NS", "revenue growth", rows, [])[0].text.includes(
      "Q1 FY2027",
    ),
  );
});
test("explicit unavailable fiscal period cannot silently substitute another year", () => {
  assert.equal(
    calculateFindings(
      "NEWCO.NS",
      "FY2028 revenue growth",
      [row("Q1 FY2027", 110)],
      [],
      "FY2028",
    ).length,
    0,
  );
});
test("quarterly comparison refuses units and basis mismatches", () => {
  const rows = [
    row("Q1 FY2027", 110),
    row("Q4 FY2026", 100, "Standalone Ind AS"),
    row("Q1 FY2026", 80, "Consolidated Ind AS", "INR million"),
  ];
  assert.equal(quarterlyComparisons(rows)[0].qoq, null);
  assert.equal(quarterlyComparisons(rows)[0].yoy, null);
});
test("minimum and maximum guidance have one-sided bounds; absent actuals refuse scoring", () => {
  const g = {
    ticker: "NEWCO.NS",
    metric: "Capex",
    period: "FY2027",
    basis: "Consolidated",
    unit: "INR crore",
    low: 100,
    high: 100,
    actual: 110,
    actual_period: "FY2027",
    actual_basis: "Consolidated",
    guidance_document: "a",
    guidance_page: 1,
    actual_document: "b",
    actual_page: 1,
    qualifier: "",
  };
  assert.equal(compareGuidance({ ...g, guidance_type: "minimum" }).variance, 0);
  assert.equal(
    compareGuidance({ ...g, guidance_type: "maximum" }).variance,
    10,
  );
  assert.equal(compareGuidance({ ...g, actual: NaN }).variance, null);
  assert.equal(
    compareGuidance({ ...g, actual_basis: "Standalone" }).variance,
    null,
  );
});
