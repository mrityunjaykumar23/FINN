import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { briefingPlan, monitoringCoverage } from "../lib/briefing-query.ts";
import {
  completedSessions,
  exchangeDate,
  type DailyObservation,
} from "../lib/market-sessions.ts";
import {
  matchFilingEvents,
  supportsEvent,
  automatedEventSupported,
} from "../lib/event-evidence.ts";
import { contiguousEvidence } from "../lib/event-analysis.ts";
import {
  parseSource,
  sourceDate,
  discoverSource,
} from "../lib/ingestion/adapters.ts";
import { defaultSettings } from "../lib/domain.ts";
import { analyzeMateriality } from "../lib/event-analysis.ts";
import { extractExplicitTables } from "../lib/financial-extraction.ts";
import { rankCandidates } from "../lib/ingestion/discovery.ts";
import { calculateFindings } from "../lib/research-analysis.ts";
import { verifyFinding } from "../lib/ai/provider.ts";
import { financialLabelSupported } from "../lib/financial-labels.ts";
test("financial labels and displayed source decimals retain their actual accounting definition", () => {
  assert.equal(
    financialLabelSupported(
      "Revenue",
      "Consolidated total income was Rs. 1465 crore.",
    ),
    false,
  );
  assert.equal(
    financialLabelSupported(
      "Total income",
      "Consolidated total income was Rs. 1465 crore.",
    ),
    true,
  );
  assert.equal(
    financialLabelSupported("Operating margin", "EBITDA margin was 9.5%."),
    false,
  );
  assert.equal(
    financialLabelSupported("Borrowings", "Gross debt was Rs. 1658 crore."),
    false,
  );
  const r = calculateFindings(
    "FIXTURE.NS",
    "What profit figures were reported?",
    [
      {
        id: "pat",
        ticker: "FIXTURE.NS",
        name: "PAT",
        value: 48.4,
        period: "Q1 FY2027",
        unit: "INR crore",
        basis: "Consolidated reported INR",
        document_id: "original",
        page: 4,
        verification_status: "source_checked",
      },
    ],
    [],
  );
  assert.match(r[0].text, /48\.4/);
});
test("reported snapshots retain compatible source metrics and research cannot relabel operating profit as EBITDA", () => {
  const metric = {
    id: "metric",
    ticker: "FIXTURE.NS",
    name: "Revenue",
    value: 1465,
    period: "Q1 FY2027",
    unit: "INR crore",
    basis: "Consolidated reported INR",
    document_id: "original",
    page: 4,
    verification_status: "source_checked",
  };
  const findings = calculateFindings(
    "FIXTURE.NS",
    "What revenue and profit figures were reported?",
    [metric],
    [],
  );
  assert.equal(findings[0].evidence_type, "reported");
  assert.match(findings[0].text, /1,465/);
  assert.deepEqual(findings[0].sources, [{ document_id: "original", page: 4 }]);
  const source = {
    id: "S1",
    document_id: "original",
    ticker: "FIXTURE.NS",
    page: 4,
    period: "Q1 FY2027",
    text: "Operating profit was INR 139 crore in Q1 FY2027.",
  };
  assert.equal(
    verifyFinding(
      {
        claim: "EBITDA was INR 139 crore in Q1 FY2027.",
        supporting_source_ids: ["S1"],
        evidence_excerpt: source.text,
        evidence_type: "reported",
        uncertainty_note: "",
      },
      "FIXTURE.NS",
      [source],
      [],
    ),
    false,
  );
});
test("materiality uses compatible company evidence, distinguishes action/direction and retains unknown magnitude", () => {
  const metric = {
    id: "annual",
    ticker: "FIXTURE.NS",
    name: "Revenue",
    value: 1000,
    period: "FY2026",
    unit: "INR crore",
    basis: "Consolidated reported INR",
    document_id: "original",
    page: 8,
    verification_status: "source_checked",
    evidence_text: "Revenue | FY2026 | 1000",
    published_at: "2026-05-01",
  };
  const context = {
    ticker: "FIXTURE.NS",
    date: "2026-11-02",
    metrics: [metric],
  };
  const small = analyzeMateriality(
      "M&A",
      "Acquisition approved; consideration of INR 1 crore.",
      context,
    ),
    large = analyzeMateriality(
      "M&A",
      "Acquisition approved; consideration of INR 600 crore.",
      context,
    );
  assert.ok(large.magnitude > small.magnitude);
  assert.equal(large.attributes.relative_reference?.metric_id, "annual");
  assert.equal(large.attributes.relative_reference?.percent, 60);
  assert.equal(
    analyzeMateriality(
      "M&A",
      "Acquisition approved; consideration INR 600 crore.",
      { ...context, metrics: [{ ...metric, ticker: "OTHER.NS" }] },
    ).attributes.magnitude_status,
    "verified_absolute",
  );
  assert.equal(
    analyzeMateriality(
      "M&A",
      "Acquisition approved; consideration undisclosed.",
      context,
    ).attributes.magnitude_status,
    "unknown",
  );
  assert.ok(
    analyzeMateriality("management_change", "CFO resigned").severity >
      analyzeMateriality("management_change", "Director appointed").severity,
  );
  assert.ok(
    analyzeMateriality("credit_rating", "Rating downgraded to AA").severity >
      analyzeMateriality("credit_rating", "Rating affirmed AAA").severity,
  );
});
test("scoped tables preserve mixed basis, scales, date periods and explicit continued pages", () => {
  const r = extractExplicitTables([
    {
      page: 1,
      text: "Consolidated results\nINR crore\nMetric | Quarter ended 31 March 2026 | Quarter ended 31 March 2025\nRevenue | 100 | 80\nStandalone results\nINR million\nMetric | FY2026 | FY2025\nPAT | 50 | 40",
    },
    { page: 2, text: "Financial statement continued\nEquity | 500 | 450" },
    { page: 3, text: "Unrelated page\nDebt | 10 | 20" },
  ]);
  assert.equal(r.metrics.length, 6);
  assert.equal(r.metrics[0].period, "Q4 FY2026");
  assert.equal(r.metrics[0].unit, "INR crore");
  assert.equal(r.metrics[2].basis, "Standalone reported INR");
  assert.equal(r.metrics[2].unit, "INR million");
  assert.equal(r.metrics[4].page, 2);
  assert.ok(r.rejected.some((x) => x.page === 3));
  assert.equal(
    extractExplicitTables([
      {
        page: 1,
        text: "Consolidated / Standalone\nINR crore\nMetric | FY2026\nPAT | 10",
      },
    ]).metrics.length,
    0,
  );
});
test("document ranking prioritises requested period, relevant type and complete evidence", () => {
  const c = {
    url: "https://issuer.invalid/a.pdf",
    title: "Annual report",
    type: "annual_report",
    published_at: null,
    period: "FY2025",
    order: 0,
  };
  const ranked = rankCandidates(
    [
      c,
      { ...c, url: "https://issuer.invalid/new.pdf", period: "FY2026" },
      {
        ...c,
        url: "https://issuer.invalid/complete.pdf",
        extraction_status: "complete",
        indexed_pages: 20,
        total_pages: 20,
      },
    ],
    "Review annual cash flow for FY2025",
  );
  assert.match(ranked[0].url, /complete/);
  assert.equal(ranked.at(-1)?.period, "FY2026");
});
// Fictional records below are isolated fixtures, never investor-facing demo data.
function fixture() {
  const d = new DatabaseSync(":memory:");
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    d.exec(readFileSync("drizzle/" + f, "utf8"));
  d.prepare("INSERT INTO companies VALUES (?,?,?,?,?)").run(
    "FIXTURE.NS",
    "ISOLATED FIXTURE",
    "test",
    "test",
    "2026",
  );
  d.prepare(
    "INSERT INTO owners(id,created_at,initialized_at) VALUES (?,?,?)",
  ).run("a", "2026", "2026");
  d.prepare("INSERT INTO portfolio_companies VALUES (?,?,?)").run(
    "a",
    "FIXTURE.NS",
    "2026",
  );
  d.prepare(
    "INSERT INTO documents(id,ticker,title,type,period,url,retrieved_at,hash,mode) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    "source",
    "FIXTURE.NS",
    "ISOLATED FIXTURE",
    "results",
    "FY2026",
    "https://example.invalid/fixture.pdf",
    "2026",
    "fixture",
    "live",
  );
  return d;
}
test("briefing reaches more than 200 filings with complete counters, separate routine cursors and no duplicates", () => {
  const db = fixture();
  for (let i = 0; i < 367; i++)
    db.prepare(
      "INSERT INTO announcements(id,ticker,hash,document_id,date,payload,category,severity,magnitude,novelty,evidence_coverage,ingestion_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      String(i).padStart(4, "0"),
      "FIXTURE.NS",
      "hash" + i,
      "source",
      "2026-10-30",
      JSON.stringify({ id: i }),
      i % 3 ? "results" : "press_release",
      i % 3 ? 30 : 5,
      i % 3 ? 20 : 0,
      5,
      8,
      "live",
    );
  const f = {
    owner: "a",
    mode: "live",
    start: "2026-10-01",
    end: "2026-11-02",
    limit: 19,
  };
  const p = briefingPlan(f, defaultSettings),
    counts = db.prepare(p.count.sql).get(...p.count.values)!;
  assert.equal(counts.total, 367);
  assert.equal(counts.important_count, 244);
  const seen = new Set();
  for (const section of ["events", "routine"] as const) {
    let cursor: string | undefined;
    do {
      const plan = briefingPlan(
        {
          ...f,
          ...(section === "events" ? { cursor } : { routine_cursor: cursor }),
        },
        defaultSettings,
        section,
      );
      const rows = db.prepare(plan.page.sql).all(...plan.page.values) as {
        id: string;
        date: string;
        score: number;
      }[];
      const page = rows.slice(0, plan.limit);
      for (const r of page) {
        assert.ok(!seen.has(r.id));
        seen.add(r.id);
        assert.ok(section === "events" ? r.score >= 50 : r.score < 50);
      }
      const last = page.at(-1);
      cursor =
        rows.length > plan.limit
          ? btoa(JSON.stringify([last!.score, last!.date, last!.id]))
          : undefined;
    } while (cursor);
  }
  assert.equal(seen.size, 367);
  const filtered = briefingPlan({ ...f, category: "results" }, defaultSettings);
  assert.equal(
    db.prepare(filtered.count.sql).get(...filtered.count.values)!.total,
    244,
  );
  db.close();
});
test("monitoring coverage uses successful source checks rather than events and rejects failed/never-checked states", () => {
  const configs = [
      { ticker: "A.NS", provider: "official" },
      { ticker: "B.NS", provider: "official" },
      { ticker: "C.NS", provider: "official" },
    ],
    rows = [
      {
        ticker: "A.NS",
        provider: "official",
        status: "success",
        last_attempt: "2026-11-02T04:00:00Z",
        last_success: "2026-11-02T04:00:00Z",
      },
      {
        ticker: "B.NS",
        provider: "official",
        status: "failed",
        last_attempt: "2026-11-02T04:00:00Z",
        last_success: "2026-11-01T04:00:00Z",
      },
    ];
  const c = monitoringCoverage(
    ["A.NS", "B.NS", "C.NS", "NEW.NS"],
    configs,
    rows,
    "2026-11-02",
    "2026-11-02",
  );
  assert.equal(c.monitored_companies, 3);
  assert.equal(c.successfully_checked_companies, 1);
  assert.deepEqual(c.unavailable_source_companies, ["B.NS"]);
  assert.deepEqual(c.never_configured_companies, ["NEW.NS"]);
  assert.equal(
    monitoringCoverage(["A.NS"], configs, rows, "2025-04-22", "2025-04-22")
      .successfully_checked_companies,
    0,
  );
});
const obs = (date: string): DailyObservation => ({
  date,
  timestamp: Date.parse(date + "T09:15:00+05:30") / 1000,
  open: 100,
  high: 110,
  low: 98,
  close: 105,
  adjusted_close: 104,
  volume: 10000,
});
test("EOD includes current IST session only after buffer, complete data and completed provider-session metadata", () => {
  const date = "2026-01-08",
    rows = [obs("2026-01-07"), obs(date)],
    end = Date.parse(date + "T15:30:00+05:30") / 1000,
    meta = {
      exchangeTimezoneName: "Asia/Kolkata",
      regularMarketTime: end,
      currentTradingPeriod: { regular: { start: end - 22500, end } },
    };
  for (const time of ["15:00", "15:35"])
    assert.equal(
      completedSessions(
        rows,
        meta,
        new Date(date + "T" + time + ":00+05:30"),
      ).points.at(-1)!.date,
      "2026-01-07",
    );
  assert.equal(
    completedSessions(rows, meta, new Date(date + "T16:00:00+05:30")).points.at(
      -1,
    )!.date,
    date,
  );
  assert.equal(
    completedSessions(
      rows,
      { ...meta, regularMarketTime: end - 3600 },
      new Date(date + "T16:00:00+05:30"),
    ).points.at(-1)!.date,
    "2026-01-07",
  );
  assert.equal(
    completedSessions(
      [rows[0], { ...rows[1], high: NaN }],
      meta,
      new Date(date + "T16:00:00+05:30"),
    ).points.length,
    1,
  );
  assert.equal(
    completedSessions(
      rows,
      { exchangeTimezoneName: "Asia/Kolkata" },
      new Date(date + "T16:00:00+05:30"),
    ).points.length,
    1,
  );
});
test("EOD calendar handles weekends, holidays, unavailable observations and UTC date rollover", () => {
  assert.equal(exchangeDate(new Date("2026-01-08T20:00:00Z")), "2026-01-09");
  const r = completedSessions(
    [obs("2026-01-23"), obs("2026-01-24"), obs("2026-01-26")],
    {},
    new Date("2026-01-27T10:00:00+05:30"),
  );
  assert.equal(r.points.length, 1);
  assert.equal(r.points[0].date, "2026-01-23");
  assert.equal(
    completedSessions([], {}, new Date("2026-01-27T10:00:00+05:30")).freshness
      .latest_completed_session,
    null,
  );
});
test("multi-page evidence selects actual financial page and separate exact dividend/management passages", () => {
  const pages = [
    {
      page: 1,
      text: "ISOLATED FIXTURE. Enclosed documents for your information and records.",
    },
    {
      page: 3,
      text: "The Board recommended a final dividend of INR 2 per share for FY2026.",
    },
    {
      page: 4,
      text: "Consolidated quarterly results Q4 FY2026. Revenue was INR 200 crore. PAT was INR 20 crore.",
    },
    {
      page: 5,
      text: "The chief financial officer resigned effective 1 April 2026.",
    },
  ];
  const events = matchFilingEvents(
    pages,
    "Board financial results and dividend",
  );
  assert.equal(events.find((e) => e.category === "results")?.page, 4);
  assert.equal(events.find((e) => e.category === "dividend")?.page, 3);
  assert.equal(events.find((e) => e.category === "management_change")?.page, 5);
  for (const e of events)
    assert.ok(pages.find((p) => p.page === e.page)!.text.includes(e.quote));
  assert.equal(supportsEvent("dividend", pages[0].text), false);
});
test("cash-flow dividends and historical transaction notes do not become new automatic events", () => {
  const cash =
    "Consolidated Statement of Cash Flows. Dividend Income (15.14). Others 22.00. Dividend paid (10026.20).";
  assert.equal(supportsEvent("dividend", cash), false);
  assert.equal(
    supportsEvent(
      "dividend",
      "The Board has declared an interim dividend of INR 2 per share.",
    ),
    true,
  );
  const note =
    "The acquisition was completed in a prior year and approved by the Board.";
  assert.equal(
    automatedEventSupported(
      "M&A",
      note,
      "Integrated Filing (Financial) Q2 FY2026",
    ),
    false,
  );
  assert.equal(automatedEventSupported("M&A", note, "Scheme of merger"), true);
  assert.ok(
    !matchFilingEvents(
      [{ page: 1, text: cash }],
      "Financial results Q2 FY2026",
    ).some((e) => e.category === "dividend"),
  );
});

test("legacy excerpt repair expands ordered original fragments and rejects invented or reversed fragments", () => {
  const page =
    "Commercial operation of 95.6 MW solar capacity.\nProject location and effective date are disclosed here.\nTotal installed capacity is 91,668 MW.";
  const quote =
    "Commercial operation of 95.6 MW solar capacity.\nTotal installed capacity is 91,668 MW.";
  assert.equal(contiguousEvidence(page, quote), page);
  assert.equal(
    contiguousEvidence(
      page,
      "Invented disclosure that is absent.\nTotal installed capacity is 91,668 MW.",
    ),
    null,
  );
  assert.equal(
    contiguousEvidence(page, quote.split("\n").reverse().join("\n")),
    null,
  );
  assert.equal(
    contiguousEvidence(page, "Total installed capacity is 91,668 MW."),
    "Total installed capacity is 91,668 MW.",
  );
});

test("source adapters keep dates tied to exact rows/objects and retain undated records for review", () => {
  const config = {
    ticker: "FIXTURE.NS",
    provider: "table",
    url: "https://issuer.invalid/list",
    officialHost: "issuer.invalid",
    layout: "sbi_table",
    note: "ISOLATED FIXTURE",
  };
  const result = parseSource(
    config,
    '<table><tr><td>02.11.2026</td><td><a href="/a.pdf/id">Original disclosure</a></td></tr><tr><td>Undated</td><td><a href="/b.pdf">Review needed</a></td></tr></table>',
    (u) => u.startsWith("https://issuer.invalid/"),
  );
  assert.equal(result[0].published_at, "2026-11-02");
  assert.equal(result[1].published_at, null);
  assert.equal(sourceDate("30.02.2026"), null);
  const json = parseSource(
    { ...config, layout: "maruti_cms" },
    JSON.stringify({
      data: {
        corporateDocumentsList: {
          items: [
            {
              _path: "original-id",
              title: "Original filing",
              date: "2026-10-09T15:46:00+05:30",
              pdfLink: { _path: "/c.pdf" },
            },
          ],
        },
      },
    }),
    () => true,
  );
  assert.equal(json[0].external_id, "original-id");
  assert.equal(json[0].source_timestamp, "2026-10-09T15:46:00+05:30");
  assert.throws(() =>
    parseSource({ ...config, layout: "maruti_cms" }, "{}", () => true),
  );
});

test("discovery resumes every older record while checking the new head", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    ticker: "FIXTURE.NS",
    provider: "table",
    url: "https://issuer.invalid/list",
    officialHost: "issuer.invalid",
    layout: "sbi_table",
    note: "Isolated fixture",
  };
  let html =
    "<table>" +
    Array.from(
      { length: 185 },
      (_, i) =>
        `<tr><td>30.10.2026</td><td><a href="/${String(i).padStart(4, "0")}.pdf">Original fixture ${i}</a></td></tr>`,
    ).join("") +
    "</table>";
  globalThis.fetch = async () => new Response(html);
  try {
    const seen = new Set<string>();
    let cursor: string | null | undefined;
    for (let n = 0; n < 4; n++) {
      const r = await discoverSource(config, "FIXTURE.NS", () => true, cursor);
      for (const c of r.items) seen.add(c.url);
      cursor = r.next_cursor;
      if (n === 0)
        html = html.replace(
          "<table>",
          '<table><tr><td>02.11.2026</td><td><a href="/new.pdf">New fixture</a></td></tr>',
        );
      if (!cursor) break;
    }
    assert.equal(seen.size, 186);
    assert.ok(seen.has("https://issuer.invalid/new.pdf"));
    assert.equal(cursor, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { documentType } from "../lib/ingestion/discovery.ts";
test("conference-call invitations are not results PDFs or completed transcripts", () => {
  assert.equal(documentType("Newspaper Publication of Audited Financial Results"), "announcement");
  assert.equal(documentType("Audio recording of the earnings call on financial results"), "announcement");
  assert.equal(
    documentType(
      "Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Intimation regarding schedule of investors and analysts results conference call for the quarter and half-year ended September 30, 2026.",
    ),
    "announcement",
  );
  assert.equal(
    documentType("Earnings Call Invitation Q2 FY2027"),
    "announcement",
  );
  assert.equal(
    documentType("Board Meeting Intimation for Financial Results"),
    "announcement",
  );
  assert.equal(
    documentType("Intimation of the earnings call transcript Q2 FY2027"),
    "transcript",
  );
  assert.equal(
    documentType("Unaudited Financial Results Q2 FY2027"),
    "results",
  );
});
