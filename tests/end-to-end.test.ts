import { extractReportedProse } from "../lib/financial-extraction.ts";
import { automatedEventSupported } from "../lib/event-evidence.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  financialUnit,
  normalizeFinancialValue,
  financialNumberToken,
} from "../lib/financial-units.ts";
import { extractPdfFinancials } from "../lib/pdf-financials.ts";
import { parseStructuredFinancials } from "../lib/structured-financials.ts";
import { snapshotMetricStates } from "../lib/snapshot-state.ts";
import { selectMetric } from "../lib/periods.ts";
import { sourceHref } from "../lib/source-references.ts";
import { financialError } from "../lib/financial-errors.ts";
import {
  parseCandidates,
  officialFinancialLinks,
  rankCandidates,
  documentType,
  locatePrimaryCandidates,
} from "../lib/ingestion/discovery.ts";
import { financialAnalysis } from "../lib/financial-analysis.ts";
import { financialContexts } from "../lib/financial-context.ts";
import { latestFinancialPeriod } from "../lib/periods.ts";
import type { Metric } from "../lib/domain.ts";
test("a stalled issuer crawl respects the shared discovery deadline and retains already discovered primary links", { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  const source = "https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=verified-results.pdf";
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://www.screener.in/company/HAVELLS/"))
      return new Response(`<a href="https://www.havells.com/">Company website</a><a href="${source}">Financial results Q2 FY2027</a>`);
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException("Fixture issuer crawl timed out", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  try {
    const started = Date.now();
    const result = await locatePrimaryCandidates("HAVELLS.NS", url => url === source, AbortSignal.timeout(30));
    assert.ok(result.candidates.some(c => c.url === source));
    assert.ok(Date.now() - started < 1000, "A slow issuer must not extend discovery past the shared phase budget");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
const source = readFileSync(
  new URL("./fixtures/ajanta-indas.html", import.meta.url),
  "utf8",
);
const company = { ticker: "AJANTPHARM.NS", name: "Ajanta Pharma Limited" };

test("authentic Ajanta presentation geometry separates EBITDA from adjusted EBITDA and percentage columns", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/ajanta-presentation-layout.json", import.meta.url),
      "utf8",
    ),
  );
  const contexts = financialContexts(
    [fixture.section, ...fixture.layouts],
    company.ticker,
  );
  const result = extractPdfFinancials(fixture.layouts, company, {
    sectionContexts: Object.fromEntries(contexts),
  });
  const get = (period: string) =>
    result.metrics.find((m) => m.name === "EBITDA" && m.period === period);
  assert.equal(get("Q2 FY2027")?.value, 543);
  assert.equal(get("Q1 FY2027")?.value, 424);
  assert.equal(get("Q2 FY2026")?.value, 328);
  assert.equal(get("H1 FY2027")?.value, 971);
  assert.equal(get("H1 FY2026")?.value, 679);
  assert.ok(
    result.metrics.every(
      (m) => m.unit === "INR crore" && !m.period.includes("Growth"),
    ),
  );
  assert.match(get("Q2 FY2027")!.extraction_context!, /Consolidated/);
});

test("XBRL contexts keep signed scaled amounts, standalone facts, nils and EPS separate", () => {
  const raw = `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in="urn:test" xmlns:xbrldi="urn:dimensions" xmlns:iso4217="urn:currency" xmlns:ix="urn:inline">
 <in:NameOfCompany>Ajanta Pharma Limited</in:NameOfCompany><in:NSESymbol>AJANTPHARM</in:NSESymbol><in:DateOfEndOfFinancialYear>2027-03-31</in:DateOfEndOfFinancialYear>
 <xbrli:context id="quarter"><xbrli:entity><xbrli:segment><xbrldi:explicitMember>Consolidated</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2026-07-01</xbrli:startDate><xbrli:endDate>2026-09-30</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:context id="half"><xbrli:entity><xbrli:segment><xbrldi:explicitMember>Standalone</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-09-30</xbrli:endDate></xbrli:period></xbrli:context>
 <xbrli:unit id="money"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
 <xbrli:unit id="share"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
 <ix:nonFraction name="in:RevenueFromOperations" contextRef="quarter" unitRef="money" scale="5">100</ix:nonFraction>
 <ix:nonFraction name="in:ProfitLossBeforeTax" contextRef="half" unitRef="money" scale="5" sign="-">20</ix:nonFraction>
 <in:BasicEarningsLossPerShare contextRef="quarter" unitRef="share">2.5</in:BasicEarningsLossPerShare>
 <in:ProfitLoss contextRef="quarter" unitRef="money" xsi:nil="true">0</in:ProfitLoss></xbrli:xbrl>`;
  const result = parseStructuredFinancials(raw, company);
  assert.equal(result.facts.length, 3);
  assert.equal(result.facts[0].value, 1);
  assert.equal(result.facts[1].value, -0.2);
  assert.equal(result.facts[1].period, "H1 FY2027");
  assert.match(result.facts[1].basis, /Standalone/);
  assert.equal(result.facts[2].value, 2.5);
  assert.equal(result.facts[2].unit, "INR/share");
  assert.equal(financialNumberToken("1,23,456.70"), 123456.7);
  assert.equal(financialNumberToken("(-100)"), null);
  assert.equal(financialNumberToken("12,34"), null);
});
test("official NSE HTML retains exact lakh facts, quarter/YTD contexts, EPS and cash-flow scope", () => {
  const result = parseStructuredFinancials(source, company);
  const get = (name: string, period = "Q2 FY2027") =>
    result.facts.find((f) => f.name === name && f.period === period)!;
  assert.equal(get("Revenue").original_value, 179416);
  assert.equal(get("Revenue").original_unit, "INR lakh");
  assert.equal(get("Revenue").value, 1794.16);
  assert.equal(get("Revenue").unit, "INR crore");
  assert.equal(get("PBT").value, 535.15);
  assert.equal(get("PAT").value, 388.14);
  assert.equal(get("Revenue", "H1 FY2027").value, 3420.12);
  assert.equal(get("PAT", "H1 FY2027").value, 722.36);
  assert.equal(get("Basic EPS").value, 31.07);
  assert.equal(get("Basic EPS").unit, "INR/share");
  assert.equal(get("Equity").period_kind, "instant");
  assert.equal(get("Operating cash flow", "H1 FY2027").value, 749.52);
  assert.equal(get("Investing cash flow", "H1 FY2027").value, -249.12);
  assert.ok(!result.facts.some((f) => f.name === "EBITDA"));
  for (const f of result.facts) {
    assert.ok(
      result.sections
        .find((s) => s.page === f.page)
        ?.text.includes(f.evidence_text),
    );
    assert.match(f.evidence_location, /table \d+, row \d+, cell \d+/);
  }
});
test("structured filing rejects wrong identity, unresolved/contradictory calendars, unknown units and external entities", () => {
  assert.throws(
    () =>
      parseStructuredFinancials(source, {
        ticker: "INFY.NS",
        name: "Infosys Limited",
      }),
    /source_verification_failed/,
  );
  assert.throws(
    () =>
      parseStructuredFinancials(
        source.replace("31-03-2027", "31-12-2027"),
        company,
      ),
    /reporting_period_unresolved/,
  );
  assert.throws(
    () =>
      parseStructuredFinancials(
        source.replace(/>Lakhs</g, ">Undeclared</g"),
        company,
      ),
    /unit_ambiguous/,
  );
  assert.throws(
    () =>
      parseStructuredFinancials(
        '<!ENTITY secret SYSTEM "file:///private">' + source,
        company,
      ),
    /Entity declarations/,
  );
});
test("scale conversion is deterministic, preserves per-share values and never performs FX conversion", () => {
  for (const [unit, input, expected] of [
    ["INR lakh", 100, 1],
    ["INR million", 10, 1],
    ["INR billion", 1, 100],
    ["INR", 1e7, 1],
    ["USD million", 5, 5],
  ] as const) {
    const u = financialUnit(unit)!;
    assert.equal(normalizeFinancialValue(input, u), expected);
  }
  assert.equal(financialUnit("INR lakh crore"), null);
  assert.equal(financialUnit("INR USD crore"), null);
  assert.equal(financialUnit("crore"), null);
  assert.equal(
    financialUnit("In INR crore except per share data")?.unit,
    "INR crore",
  );
  assert.equal(financialUnit("INR lakh", true)?.normalization_factor, 1);
});
test("one failed source cannot become four failed metric attempts", () => {
  const failure = {
    id: "failed-download",
    url: "https://primary.example/results.pdf",
    status: "failed",
    document_id: null,
    error: "Source unavailable",
    error_code: "source_unavailable",
    failed_stage: "download",
  };
  const input = {
    metrics: [],
    period: null,
    basis: "Consolidated",
    job: { status: "complete", phase: "complete" },
    sources: [failure],
    progress: [],
  };
  const result = snapshotMetricStates(input);
  assert.ok(result.statuses.every((s) => s.state === "Source found"));
  assert.equal(result.readiness, "needs_sources");
  const bank = snapshotMetricStates({ ...input, financialSector: true });
  assert.equal(
    bank.statuses.find((s) => s.name === "EBITDA")?.state,
    "Not applicable",
  );
});
test("exact structured statements outrank rounded summaries while conflicting exact contexts remain unavailable", () => {
  const f = parseStructuredFinancials(source, company).facts.find(
    (f) => f.name === "Revenue" && f.period === "Q2 FY2027",
  )!;
  const metric = {
    ...f,
    id: "exact",
    ticker: company.ticker,
    document_id: "original",
  };
  const rounded = {
    ...metric,
    id: "summary",
    value: 1794,
    verification_status: "source_checked",
    basis: "Consolidated, reported currency",
  };
  assert.equal(
    selectMetric([rounded, metric], "Revenue", "Q2 FY2027")?.value,
    1794.16,
  );
  assert.equal(
    selectMetric(
      [metric, { ...metric, id: "conflict", value: 1795 }],
      "Revenue",
      "Q2 FY2027",
    ),
    undefined,
  );
});
test("HTML citations use real structured locations, and safe errors remove credentials and stack traces", () => {
  const url = "https://nsearchives.nseindia.com/corporate/ixbrl/example.html";
  assert.equal(sourceHref(url, 2, "structured_html"), url);
  assert.equal(
    sourceHref("https://primary.example/report.pdf", 2, "pdf"),
    "https://primary.example/report.pdf#page=2",
  );
  const error = financialError(
    new Error("HTTP 503 ?key=private-value\n    at internal"),
  );
  assert.equal(error.code, "source_unavailable");
  assert.ok(!error.message.includes("private-value"));
  assert.ok(!error.message.includes("at internal"));
});
test("generic official discovery handles HTTP website metadata and relative primary links", () => {
  const allow = (u: string, h?: string) =>
    new URL(u).hostname.replace(/^www\./, "") === h ||
    new URL(u).hostname === "nsearchives.nseindia.com";
  const parsed = parseCandidates(
    '<a href="http://www.ajantapharma.com">Website</a>',
    allow,
  );
  assert.equal(parsed.officialHost, "ajantapharma.com");
  const result = officialFinancialLinks(
    '<a href="/reports/Q2FY2027-press-release.pdf">Q2 FY2027 Press Release</a><a href="/investors/quarterly-results">Quarterly results</a>',
    "https://www.ajantapharma.com/",
    "ajantapharma.com",
    allow,
  );
  assert.equal(result.candidates[0].type, "results");
  assert.equal(result.candidates[0].period, "Q2 FY2027");
  assert.ok(result.pages[0].url.startsWith("https://"));
});
test("actual Ajanta cash flow and balance facts produce compatible, source-linked calculations", () => {
  const metrics = parseStructuredFinancials(source, company).facts.map(
    (f, i) => ({
      ...f,
      id: String(i),
      ticker: company.ticker,
      document_id: "nse-original",
    }),
  );
  const half = financialAnalysis(metrics, "H1 FY2027"),
    quarter = financialAnalysis(metrics, "Q2 FY2027");
  const value = (rows: ReturnType<typeof financialAnalysis>, name: string) =>
    rows.find((c) => c.name === name)!;
  assert.ok(Math.abs(value(half, "Free cash flow").value! - 490.49) < 1e-8);
  assert.ok(
    Math.abs(value(half, "Cash conversion").value! - (749.52 / 722.36) * 100) <
      1e-8,
  );
  assert.ok(
    Math.abs(value(quarter, "PAT margin").value! - (388.14 / 1794.16) * 100) <
      1e-8,
  );
  assert.ok(
    Math.abs(value(quarter, "Borrowings-to-equity").value! - 104.3 / 4858.27) <
      1e-8,
  );
  assert.equal(value(quarter, "ROE").value, null);
  for (const c of [...half, ...quarter].filter((c) => c.value !== null)) {
    assert.ok(c.inputs.length);
    assert.ok(
      c.inputs.every(
        (m) => m.document_id === "nse-original" && m.evidence_location,
      ),
    );
    assert.equal(c.verification_status, "deterministic");
  }
});
function money(name: string, value: number, period = "FY2027"): Metric {
  return {
    id: name + period,
    ticker: "FIXTURE.NS",
    name,
    value,
    period,
    unit: "INR crore",
    basis: "Consolidated reported INR",
    currency: "INR",
    scale: "crore",
    document_id: "fixture-financial-statement",
    page: 1,
    verification_status: "structured_verified",
    period_start: period === "FY2027" ? "2026-04-01" : null,
    period_end: period === "FY2027" ? "2027-03-31" : null,
  };
}
test("annual capital returns, signed capex and working capital use valid denominators and verified days", () => {
  const rows = [
    money("Revenue", 1000),
    money("PAT", 100),
    money("EBIT", 150),
    money("Operating cash flow", 120),
    money("Capital expenditure", -30),
    money("Debt", 200),
    money("Equity", 500),
    money("Equity", 400, "FY2026"),
    money("Assets", 1000),
    money("Assets", 900, "FY2026"),
    money("Current assets", 300),
    money("Current liabilities", 200),
    money("Current liabilities", 180, "FY2026"),
    money("Inventory", 80),
    money("Inventory", 60, "FY2026"),
    money("Receivables", 100),
    money("Receivables", 80, "FY2026"),
    money("Payables", 50),
    money("Payables", 40, "FY2026"),
    money("Cost of goods sold", 400),
  ];
  const a = financialAnalysis(rows, "FY2027"),
    value = (n: string) => a.find((c) => c.name === n)!.value!;
  assert.equal(value("Free cash flow"), 90);
  assert.equal(value("Debt-to-equity"), 0.4);
  assert.equal(value("Current ratio"), 1.5);
  assert.equal(value("Quick ratio"), 1.1);
  assert.ok(Math.abs(value("ROE") - (100 / 450) * 100) < 1e-8);
  assert.ok(Math.abs(value("ROCE") - (150 / 760) * 100) < 1e-8);
  assert.ok(Math.abs(value("Inventory days") - 63.875) < 1e-8);
  assert.ok(
    Math.abs(value("Cash conversion cycle (revenue/COGS proxy)") - 55.6625) <
      1e-8,
  );
  assert.equal(
    financialAnalysis(
      rows.map((m) => (m.name === "Equity" ? { ...m, value: 0 } : m)),
      "FY2027",
    ).find((c) => c.name === "Debt-to-equity")!.value,
    null,
  );
});
test("TTM requires four consecutive quarters and cannot borrow half-year totals or incompatible currencies", () => {
  const rows = [
    money("Revenue", 1000, "Q2 FY2027"),
    money("Revenue", 900, "Q1 FY2027"),
    money("Revenue", 800, "Q4 FY2026"),
    money("Revenue", 700, "Q3 FY2026"),
    money("Revenue", 2000, "H1 FY2027"),
  ];
  const ttm = (r: Metric[]) =>
    financialAnalysis(r, "Q2 FY2027").find((c) => c.name === "TTM Revenue")!
      .value;
  assert.equal(ttm(rows), 3400);
  assert.equal(ttm(rows.filter((m) => m.period !== "Q4 FY2026")), null);
  assert.equal(
    ttm(
      rows.map((m) =>
        m.period === "Q4 FY2026" ? { ...m, currency: "USD" } : m,
      ),
    ),
    null,
  );
});
test("CAGR requires compatible positive annual endpoints; industrial ratios are not applied to banks", () => {
  const rows = [
    money("Revenue", 100, "FY2025"),
    money("Revenue", 110, "FY2026"),
    money("Revenue", 121, "FY2027"),
  ];
  assert.ok(
    Math.abs(
      financialAnalysis(rows, "FY2027").find((c) => c.name === "Revenue CAGR")!
        .value! - 10,
    ) < 1e-8,
  );
  assert.ok(
    financialAnalysis(rows, "FY2027", "financial")
      .filter((c) => /EBITDA|Free cash flow|ROCE|Inventory days/.test(c.name))
      .every((c) => c.status === "not_applicable"),
  );
  assert.equal(latestFinancialPeriod(["Q3 FY2026", "FY2027"]), "FY2027");
  assert.equal(latestFinancialPeriod(["FY2027", "Q4 FY2027"]), "Q4 FY2027");
});
test("financial section context clears at another entity and never carries a JPL scope into RJIL", () => {
  const map = financialContexts(
    [
      { page: 1, text: "Financial Highlights (Consolidated)" },
      { page: 2, text: "Current quarter income statement" },
      { page: 3, text: "RJIL Consolidated Financial Highlights" },
      { page: 4, text: "Revenue and profit" },
    ],
    "JPL.NS",
  );
  assert.equal(map.get(2)?.basis, "Consolidated");
  assert.equal(map.has(3), false);
  assert.equal(map.has(4), false);
});

test("current source ranking cannot prefer an archived descriptive report or a voting-results notice", () => {
  const c = (title: string, period: string, order: number) => ({
    title,
    period,
    type: documentType(title + " /Financial/Quarterly-Results/"),
    order,
    url: `https://primary.example/${order}.pdf`,
    published_at: null,
  });
  const rows = rankCandidates(
    [
      c("Financial results Q1 FY2017", "Q1 FY2017", 0),
      c("Information Update Q2 FY27", "Q2 FY2027", 120),
      c("Published Results Q2 FY27", "Q2 FY2027", 133),
      c("Financial Results Q1 FY27", "Q1 FY2027", 200),
    ],
    "latest financial results",
  );
  assert.equal(rows[0].period, "Q2 FY2027");
  assert.equal(rows[1].period, "Q2 FY2027");
  assert.equal(
    documentType("Outcome of PB Voting Results Scrutinizers Report"),
    "announcement",
  );
  assert.equal(financialUnit("Rs in unknown-scale"), null);
  assert.equal(financialUnit("INR croreish"), null);
});

test("authentic Havells layouts preserve standalone summaries and rotated consolidated statements independently", () => {
  const f = JSON.parse(
    readFileSync(
      new URL("./fixtures/havells-presentation-layout.json", import.meta.url),
      "utf8",
    ),
  );
  const contexts = financialContexts([f.section, ...f.layouts], "HAVELLS.NS");
  const summary = extractPdfFinancials(
    f.layouts,
    { ticker: "HAVELLS.NS", name: "Havells India Limited" },
    { sectionContexts: Object.fromEntries(contexts) },
  );
  const statement = extractPdfFinancials(
    JSON.parse(
      readFileSync(
        new URL("./fixtures/havells-results-layout.json", import.meta.url),
        "utf8",
      ),
    ),
    { ticker: "HAVELLS.NS", name: "Havells India Limited" },
  );
  const rows = [...summary.metrics, ...statement.metrics].map((m, i) => ({
    ...m,
    id: String(i),
    ticker: "HAVELLS.NS",
    document_id: "original",
  }));
  assert.equal(statement.calendar?.month, 3);
  assert.equal(selectMetric(rows, "Revenue", "Q2 FY2027")?.value, 6431.99);
  assert.equal(selectMetric(rows, "PBT", "Q2 FY2027")?.value, 472.62);
  assert.equal(selectMetric(rows, "PAT", "Q2 FY2027")?.value, 349.22);
  assert.equal(
    selectMetric(
      rows.filter((m) => /Standalone/.test(m.basis)),
      "Revenue",
      "Q2 FY2027",
    )?.value,
    6416.62,
  );
  assert.equal(
    selectMetric(
      rows.filter((m) => /Standalone/.test(m.basis)),
      "EBITDA",
      "Q2 FY2027",
    )?.value,
    576,
  );
  assert.ok(statement.metrics.every((m) => m.unit === "INR crore"));
});

test("dated prose needs a verified fiscal year end, and statement cash-flow dividends are not new declarations", () => {
  const pages = [
    {
      page: 1,
      text: "Consolidated Results\nFor the Quarter ended September 30, 2026\nTotal Revenue stood at Rs.100 crore.",
    },
  ];
  assert.equal(extractReportedProse(pages).metrics.length, 0);
  assert.equal(extractReportedProse(pages, 12).metrics[0]?.period, "Q3 FY2026");
  assert.equal(extractReportedProse(pages, 3).metrics[0]?.period, "Q2 FY2027");
  assert.equal(
    automatedEventSupported(
      "dividend",
      "Dividend Income 15.14 The financial results were approved by the Board.",
      "Integrated Filing Financial",
    ),
    false,
  );
  assert.equal(
    automatedEventSupported(
      "dividend",
      "The Board recommended a final dividend of Rs 5 per share.",
      "Financial results",
    ),
    true,
  );
  assert.equal(
    automatedEventSupported(
      "M&A",
      "The acquisition was approved in the prior financial year.",
      "M&A: Integrated Filing Financial",
    ),
    false,
  );
});

test("invalid PDF bytes and source/Gemini rate limits retain different failure categories", async () => {
  const { getDocumentProxy } = await import("unpdf");
  await assert.rejects(() =>
    getDocumentProxy(
      new TextEncoder().encode("%PDF-1.7\nnot a PDF object or trailer"),
    ),
  );
  assert.equal(
    financialError(new Error("HTTP 429; source cooling down"), "download").code,
    "source_unavailable",
  );
  assert.equal(
    financialError(new Error("429 Gemini quota exhausted"), "extraction").code,
    "gemini_rate_limit",
  );
});

test("equivalent reported-currency basis spellings do not hide independently verified facts", () => {
  const a = money("Revenue", 1794, "Q2 FY2027"),
    b = { ...a, id: "other-original", basis: "consolidated reported currency" };
  assert.equal(selectMetric([a, b], "Revenue", "Q2 FY2027")?.value, 1794);
  const standards = [
    { ...a, basis: "Consolidated IFRS reported INR" },
    { ...b, basis: "Consolidated Ind AS reported INR" },
  ];
  assert.equal(selectMetric(standards, "Revenue", "Q2 FY2027"), undefined);
});
