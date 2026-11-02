import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractPdfFinancials,
  financialHeaderDate,
  fiscalLabel,
  type PdfLayout,
} from "../lib/pdf-financials.ts";
import { verifiedYahooDaily, type YahooResult } from "../lib/yahoo-data.ts";
import {
  expectedCompletedSession,
  marketFreshness,
} from "../lib/market-state.ts";
import { marketSummary } from "../lib/domain.ts";
import { quarterlyComparisons, sortPeriods } from "../lib/periods.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/jpl-financial-layout.json", import.meta.url),
    "utf8",
  ),
) as { results: PdfLayout[]; presentation: PdfLayout[] };
const company = { ticker: "JPL.NS", name: "Jio Platforms Limited" };
const verified = { currency: "INR", yearEndMonth: 3 };
test("Infosys split headers and statement note references retain the original quarter and half-year", () => {
  const layouts = JSON.parse(
    readFileSync(
      new URL("./fixtures/infy-financial-layout.json", import.meta.url),
      "utf8",
    ),
  ) as PdfLayout[];
  const parsed = extractPdfFinancials(layouts, {
    ticker: "INFY.NS",
    name: "Infosys Limited",
  });
  const quarter = parsed.metrics.filter(
    (m) => m.period === "Q2 FY2027" && m.basis.startsWith("Consolidated"),
  );
  assert.equal(parsed.calendar?.month, 3);
  assert.equal(quarter.find((m) => m.name === "Revenue")?.value, 49244);
  assert.equal(quarter.find((m) => m.name === "PBT")?.value, 11063);
  assert.equal(quarter.find((m) => m.name === "PAT")?.value, 7838);
  assert.equal(
    parsed.metrics.find(
      (m) =>
        m.name === "Revenue" &&
        m.period === "H1 FY2027" &&
        m.basis.startsWith("Consolidated"),
    )?.value,
    97454,
  );
  assert.ok(!parsed.metrics.some((m) => m.name === "EBITDA"));
});
test("a damaged currency glyph blocks financial acceptance while preserving verified statement periods", () => {
  const layouts = JSON.parse(
    readFileSync(
      new URL("./fixtures/dabur-financial-layout.json", import.meta.url),
      "utf8",
    ),
  ) as PdfLayout[];
  const parsed = extractPdfFinancials(layouts, {
    ticker: "DABUR.NS",
    name: "Dabur India Limited",
  });
  assert.ok(parsed.periods.includes("Q1 FY2027"));
  assert.ok(parsed.periods.includes("FY2026"));
  assert.equal(parsed.metrics.length, 0);
  assert.ok(parsed.reviews.some((r) => /Currency\/scale/.test(r.reason)));
});
test("actual JPL original columns preserve quarterly, half-year and standalone scope", () => {
  const { metrics, calendar, reviews } = extractPdfFinancials(
    fixture.results,
    company,
    verified,
  );
  assert.equal(calendar?.month, 3);
  assert.deepEqual(reviews, []);
  const value = (n: string, p: string, b = "Consolidated") =>
    metrics.find((m) => m.name === n && m.period === p && m.basis.startsWith(b))
      ?.value;
  assert.equal(value("Revenue", "Q2 FY2027"), 40475);
  assert.equal(value("Revenue", "H1 FY2027"), 79648);
  assert.equal(value("PBT", "Q2 FY2027"), 11259);
  assert.equal(value("PAT", "Q2 FY2027"), 8387);
  assert.equal(
    value("PAT", "Q2 FY2026"),
    7375,
    "Use the final group total including associates/JVs, not the earlier subtotal or owners' allocation",
  );
  assert.equal(value("Revenue", "Q2 FY2027", "Standalone"), 4881);
  assert.equal(value("PAT", "Q2 FY2027", "Standalone"), 419);
  assert.equal(value("Revenue", "H1 FY2026", "Standalone"), 7620);
  assert.equal(value("Revenue", "FY2026", "Standalone"), 16167);
  assert.ok(
    metrics.every(
      (m) =>
        fixture.results.find((p) => p.page === m.page)?.text ===
        m.evidence_text,
    ),
  );
});
test("JPL EBITDA comes from its original presentation and operating profit is not silently relabelled", () => {
  const { metrics } = extractPdfFinancials(
    fixture.presentation,
    company,
    verified,
  );
  assert.equal(
    metrics.find((m) => m.name === "EBITDA" && m.period === "Q2 FY2027")?.value,
    21879,
  );
  const altered = structuredClone(fixture.presentation);
  for (const p of altered)
    for (const i of p.items)
      if (i.text.trim() === "EBITDA") i.text = "Operating profit";
  assert.ok(
    !extractPdfFinancials(altered, company, verified).metrics.some(
      (m) => m.name === "EBITDA",
    ),
  );
  assert.equal(
    extractPdfFinancials(
      fixture.results,
      { ticker: "INFY.NS", name: "Infosys Limited" },
      verified,
    ).metrics.length,
    0,
  );
});
test("missing annual calendar evidence and colliding numeric cells cannot create guessed or concatenated figures", () => {
  const altered = structuredClone(fixture.results);
  for (const p of altered)
    p.items = p.items.filter(
      (i) => !/^Year ended/i.test(i.text) && !/^31/.test(i.text),
    );
  assert.equal(extractPdfFinancials(altered, company).metrics.length, 0);
  const partial = extractPdfFinancials(altered, company, verified);
  assert.ok(partial.reviews.some((r) => /concatenated/.test(r.reason)));
  assert.ok(
    !partial.metrics.some((m) =>
      [762016167, 7871720, 5861281].includes(m.value!),
    ),
  );
  assert.deepEqual(financialHeaderDate("31stMar'26"), { month: 3, year: 2026 });
  assert.equal(financialHeaderDate("30.02.2026"), null);
  assert.equal(fiscalLabel(9, 2026, 3, "quarter"), "Q2 FY2027");
  assert.equal(fiscalLabel(9, 2026, 12, "quarter"), "Q3 FY2026");
});
test("half-year metrics remain selectable without becoming quarterly comparisons", () => {
  assert.deepEqual(sortPeriods(["Q1 FY2027", "H1 FY2027", "Q2 FY2027"]), [
    "Q2 FY2027",
    "H1 FY2027",
    "Q1 FY2027",
  ]);
  const rows = extractPdfFinancials(fixture.results, company, verified)
    .metrics.filter((m) => m.basis.startsWith("Consolidated"))
    .map((m, i) => ({
      ...m,
      id: String(i),
      ticker: "JPL.NS",
      document_id: "primary-fixture",
    }));
  const half = quarterlyComparisons(rows, "H1 FY2027").find(
    (m) => m.name === "Revenue",
  )!;
  assert.equal(half.qoq, null);
  assert.ok(half.yoy !== null);
  assert.equal(half.values[0]?.value, 79648);
  const quarter = quarterlyComparisons(rows, "Q2 FY2027").find(
    (m) => m.name === "Revenue",
  )!;
  assert.equal(quarter.values[0]?.value, 40475);
  assert.equal(quarter.values[1]?.value, 39173);
});
function daily(): YahooResult {
  return {
    timestamp: [
      Date.parse("2026-10-28T10:00:00Z") / 1000,
      Date.parse("2026-10-29T10:00:00Z") / 1000,
    ],
    meta: {
      symbol: "FIXTURE.NS",
      dataGranularity: "1d",
      firstTradeDate: Date.parse("2026-10-28T03:45:00Z") / 1000,
    },
    indicators: {
      quote: [
        {
          open: [100, 100],
          high: [102, 111],
          low: [99, 99],
          close: [100, 110],
          volume: [1000, 2000],
        },
      ],
      adjclose: [{ adjclose: [50, 55] }],
    },
  };
}
test("new listing uses comparable adjusted daily closes and rejects intraday, wrong-ticker and pre-listing observations", () => {
  const d = daily(),
    now = new Date("2026-11-03T09:00:00+05:30");
  const v = verifiedYahooDaily(d, "FIXTURE.NS", now),
    summary = marketSummary(v.points, 20);
  assert.equal(summary.change, 10);
  assert.equal(summary.relative_volume, null);
  const wrong = structuredClone(d);
  wrong.meta.dataGranularity = "5m";
  assert.throws(() => verifiedYahooDaily(wrong, "FIXTURE.NS", now), /intraday/);
  assert.throws(() => verifiedYahooDaily(d, "OTHER.NS", now), /ticker/);
  d.meta.firstTradeDate = Date.parse("2026-10-29T03:45:00Z") / 1000;
  assert.equal(verifiedYahooDaily(d, "FIXTURE.NS", now).points.length, 1);
  const missing = structuredClone(d);
  delete missing.indicators.adjclose;
  const raw = verifiedYahooDaily(missing, "FIXTURE.NS", now).points;
  assert.equal(raw.length, 1);
  assert.equal(raw[0].adjusted_close, null);
  assert.equal(marketSummary(raw).close, 110);
  assert.equal(marketSummary(raw).change, null);
  const incomplete = daily();
  incomplete.indicators.quote[0].close[1] = null;
  incomplete.indicators.adjclose![0].adjclose[1] = null;
  const retained = verifiedYahooDaily(incomplete, "FIXTURE.NS", now).points;
  assert.equal(retained.length, 1);
  assert.equal(
    retained[0].date,
    "2026-10-28",
    "An incomplete latest bar must not be filled from open, high or the previous close",
  );
});
test("latest completed NSE session and failure freshness retain actual observation dates and retry cooldowns", () => {
  const now = new Date("2026-11-03T09:00:00+05:30");
  assert.equal(expectedCompletedSession(now), "2026-11-02");
  assert.equal(
    expectedCompletedSession(new Date("2026-11-01T09:00:00+05:30")),
    "2026-10-30",
  );
  const f = marketFreshness(
    "2026-10-30",
    {
      status: "failed",
      last_success: "2026-10-30T12:00:00Z",
      last_attempt: now.toISOString(),
      error: "Provider unavailable",
    },
    now,
  );
  assert.equal(f.observed_session, "2026-10-30");
  assert.equal(f.stale, true);
  assert.equal(f.can_refresh, false);
  assert.match(f.error!, /unavailable/);
});
