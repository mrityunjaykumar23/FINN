import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { calculateFindings } from "../lib/research-analysis.ts";
import { quarterlyComparisons, selectMetric } from "../lib/periods.ts";
import {
  analyzeMateriality,
  eventEvidence,
  normalizeEvidence,
} from "../lib/event-analysis.ts";
import {
  filingPageQuery,
  filingByIdQuery,
  passageQuery,
  companySyncBatch,
} from "../lib/query-plans.ts";
import { extractExplicitTables } from "../lib/financial-extraction.ts";
import {
  parseCandidates,
  rankCandidates,
  parseOfficialTable,
} from "../lib/ingestion/discovery.ts";
import { parseNseDirectory } from "../lib/company-directory.ts";
import { modelForTask, aiStatus, AiFailure } from "../lib/ai/gemini.ts";
import {
  verifyFinding,
  analyzeCompanyResearch,
  extractFinancialMetrics,
} from "../lib/ai/provider.ts";
import type { Metric } from "../lib/domain.ts";
// All fictional numbers and companies in this file are isolated regression fixtures.
const metric = (
  name: string,
  period: string,
  value: number,
  extra: Partial<Metric> = {},
): Metric => ({
  id: `${name}:${period}:${value}`,
  ticker: "FIXTURE.NS",
  name,
  period,
  value,
  basis: "Consolidated reported INR",
  unit: "INR crore",
  document_id: "fixture",
  page: 1,
  verification_status: "source_checked",
  ...extra,
});
function database() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`drizzle/${f}`, "utf8"));
  for (const ticker of ["FIXTURE.NS", "OTHER.NS"])
    db.prepare(
      "INSERT INTO companies(ticker,name,sector,validation,updated_at) VALUES (?,?,?,?,?)",
    ).run(ticker, "ISOLATED TEST FIXTURE", "test", "test", "2026");
  for (const [id, ticker, period] of [
    ["fixture", "FIXTURE.NS", "FY2026"],
    ["other", "OTHER.NS", "FY2026"],
    ["old", "FIXTURE.NS", "FY2025"],
  ])
    db.prepare(
      "INSERT INTO documents(id,ticker,title,type,period,url,published_at,retrieved_at,hash,mode) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      ticker,
      "ISOLATED FIXTURE",
      "annual_report",
      period,
      "https://example.invalid/fixture.pdf",
      "2026-01-01",
      "2026",
      id,
      "historical",
    );
  return db;
}
test("cash wording and calculations follow actual fiscal years, signed capex and compatible sources", () => {
  for (const year of [2024, 2025, 2026])
    for (const capex of [20, -20]) {
      const rows = [
        metric("Operating cash flow", `FY${year}`, 100),
        metric("Capital expenditure", `FY${year}`, capex),
        metric("PAT", `FY${year}`, 80),
      ];
      const found = calculateFindings(
        "FIXTURE.NS",
        "cash conversion",
        rows,
        [],
      );
      assert.ok(
        found.some((f) =>
          f.text.includes(`FY${year} calculated free cash flow was ₹80 crore`),
        ),
      );
      assert.ok(found.every((f) => !f.text.includes(`FY${year + 1}`)));
      assert.equal(
        calculateFindings("FIXTURE.NS", "cash", rows, [], "FY2030").length,
        0,
      );
      assert.equal(calculateFindings("OTHER.NS", "cash", rows, []).length, 0);
      assert.equal(
        calculateFindings(
          "FIXTURE.NS",
          "cash",
          [rows[0], { ...rows[1], unit: "USD million" }],
          [],
        ).length,
        0,
      );
    }
});
test("quarter facts reject unverified, conflicting duplicate, currency, zero and negative bases; explicit restatement wins", () => {
  const cur = metric("Revenue", "Q1 FY2026", 120),
    prev = metric("Revenue", "Q4 FY2025", 100),
    year = metric("Revenue", "Q1 FY2025", 80);
  assert.equal(quarterlyComparisons([cur, prev, year])[0].qoq, 20);
  for (const value of [0, -100])
    assert.equal(quarterlyComparisons([cur, { ...prev, value }])[0].qoq, null);
  assert.equal(
    quarterlyComparisons([
      cur,
      { ...prev, currency: "USD" },
      { ...cur, currency: "INR" },
    ])[0].qoq,
    null,
  );
  assert.equal(
    quarterlyComparisons(
      [{ ...cur, verification_status: "unverified" }, prev],
      cur.period,
    )[0].values[0],
    undefined,
  );
  assert.equal(
    selectMetric(
      [cur, { ...cur, id: "conflict", value: 121 }],
      "Revenue",
      cur.period,
    ),
    undefined,
  );
  assert.equal(
    selectMetric(
      [
        cur,
        {
          ...cur,
          id: "restate",
          value: 121,
          reporting_status: "restated",
          published_at: "2026-01-01",
        },
      ],
      "Revenue",
      cur.period,
    )?.value,
    121,
  );
  assert.equal(
    selectMetric([cur, { ...cur, id: "duplicate" }], "Revenue", cur.period)
      ?.value,
    120,
  );
});
test("same-page fixture events have independent source identity, independent alerts and alternate headlines cannot change identity", () => {
  const text =
    "Quarterly financial results: consolidated revenue was INR 100 crore. The CFO resigned effective March 1, 2026.";
  const result = eventEvidence(text, "results"),
    management = eventEvidence(text, "management_change");
  assert.notEqual(normalizeEvidence(result), normalizeEvidence(management));
  assert.equal(eventEvidence(text, "results"), result);
  assert.throws(() => eventEvidence(text, "results", "Fabricated statement"));
  const db = database();
  for (const [i, quote] of [result, management].entries()) {
    db.prepare(
      "INSERT INTO announcements(id,ticker,hash,document_id,date,payload,event_signature) VALUES (?,?,?,?,?,?,?)",
    ).run(
      `event${i}`,
      "FIXTURE.NS",
      `hash${i}`,
      "fixture",
      "2026-01-01",
      JSON.stringify({ evidence_page: 1 }),
      normalizeEvidence(quote),
    );
    db.prepare("INSERT OR IGNORE INTO owners(id,created_at) VALUES (?,?)").run(
      "fixture-owner",
      "2026",
    );
    db.prepare(
      "INSERT INTO alerts(id,owner,payload,triggered_at,announcement_id) VALUES (?,?,?,?,?)",
    ).run(`alert${i}`, "fixture-owner", "{}", "2026", `event${i}`);
  }
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO announcements(id,ticker,hash,document_id,date,payload,event_signature) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        "alternate-headline",
        "FIXTURE.NS",
        "other-hash",
        "fixture",
        "2026",
        "{}",
        normalizeEvidence(result),
      ),
  );
  assert.equal(db.prepare("SELECT count(*) n FROM alerts").get()!.n, 2);
  db.close();
});
test("materiality responds to verified monetary size, action and unknown magnitude", () => {
  const small = analyzeMateriality(
    "M&A",
    "Proposed acquisition for INR 2 crore; 51% stake.",
  );
  const large = analyzeMateriality(
    "M&A",
    "Completed acquisition for INR 12000 crore; 100% stake.",
  );
  assert.ok(large.magnitude > small.magnitude);
  assert.equal(large.attributes.action?.toLowerCase(), "completed");
  const unknown = analyzeMateriality("M&A", "An acquisition was proposed.");
  assert.equal(unknown.attributes.magnitude_status, "unknown");
  assert.ok(unknown.magnitude > 0);
  assert.ok(
    analyzeMateriality("management_change", "The CFO resigned.").severity >
      analyzeMateriality("press_release", "Routine compliance disclosure.")
        .severity,
  );
  assert.ok(
    analyzeMateriality(
      "litigation",
      "A penalty of INR 10000 crore was imposed.",
    ).magnitude > small.magnitude,
  );
  assert.ok(
    analyzeMateriality(
      "results",
      "Revenue increased 15%; profit decreased 25%.",
    ).magnitude > 12.5,
  );
  assert.equal(
    analyzeMateriality("unclassified", "Unclear filing").attributes
      .magnitude_status,
    "unknown",
  );
});
test("FTS retrieves evidence beyond 2500 chunks directly, with company/period/type scope and synonyms", () => {
  const db = database(),
    put = db.prepare(
      "INSERT INTO document_chunks(id,document_id,ticker,page,text) VALUES (?,?,?,?,?)",
    );
  for (let i = 0; i < 2605; i++)
    put.run(
      `fixture:${i}`,
      "fixture",
      "FIXTURE.NS",
      i + 1,
      i === 2604
        ? "Net profit and cash from operations supported the unique expansion commitment."
        : "Routine isolated fixture filler.",
    );
  put.run(
    "other:1",
    "other",
    "OTHER.NS",
    1,
    "Net profit and cash from operations supported expansion.",
  );
  let p = passageQuery("FIXTURE.NS", "PAT CFO expansion", { period: "FY2026" });
  let rows = db.prepare(p.sql).all(...p.values);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].page, 2605);
  assert.equal(rows[0].document_id, "fixture");
  p = passageQuery("FIXTURE.NS", "PAT CFO expansion", { period: "FY2025" });
  assert.equal(db.prepare(p.sql).all(...p.values).length, 0);
  p = passageQuery("FIXTURE.NS", "PAT CFO expansion", { type: "transcript" });
  assert.equal(db.prepare(p.sql).all(...p.values).length, 0);
  p = passageQuery("FIXTURE.NS", "unfindablexyz");
  assert.equal(db.prepare(p.sql).all(...p.values).length, 0);
  db.close();
});
test("cursor pagination reaches all 620 events without duplicate IDs and direct lookup retrieves oldest", () => {
  const db = database();
  for (let i = 0; i < 620; i++)
    db.prepare(
      "INSERT INTO announcements(id,ticker,hash,document_id,date,payload,category,ingestion_mode,materiality_score) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      String(i).padStart(4, "0"),
      "FIXTURE.NS",
      `hash${i}`,
      "fixture",
      `2026-01-${i % 2 === 0 ? "01" : "02"}`,
      JSON.stringify({ id: i }),
      "results",
      "historical",
      75,
    );
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const p = filingPageQuery({
      ticker: "FIXTURE.NS",
      mode: "historical",
      category: "results",
      priority: 50,
      limit: 37,
      cursor,
    });
    const rows = db.prepare(p.sql).all(...p.values) as {
      id: string;
      date: string;
    }[];
    const page = rows.slice(0, p.limit);
    for (const r of page) {
      assert.ok(!seen.has(r.id));
      seen.add(r.id);
    }
    const last = page.at(-1);
    cursor =
      rows.length > p.limit
        ? btoa(JSON.stringify([last!.date, last!.id]))
        : undefined;
  } while (cursor);
  assert.equal(seen.size, 620);
  assert.equal(
    JSON.parse(
      (db.prepare(filingByIdQuery).get("0000") as { payload: string }).payload,
    ).id,
    0,
  );
  const p = filingPageQuery({ ticker: "OTHER.NS" });
  assert.equal(db.prepare(p.sql).all(...p.values).length, 0);
  assert.throws(() => filingPageQuery({ cursor: "bad" }));
  db.close();
});
test("cache revisions change for guidance/metric/chunk inputs and remain isolated from unrelated companies", () => {
  const db = database(),
    revision = () =>
      db
        .prepare(
          "SELECT revision FROM company_versions WHERE ticker='FIXTURE.NS'",
        )
        .get()!.revision;
  const before = revision();
  db.prepare("INSERT INTO document_chunks VALUES (?,?,?,?,?)").run(
    "fixture:1",
    "fixture",
    "FIXTURE.NS",
    1,
    "Verified guidance 3 to 5 percent for FY2026",
  );
  assert.notEqual(revision(), before);
  const beforeGuidance = revision();
  db.prepare(
    "INSERT INTO guidance_statements(id,ticker,metric,statement_text,guidance_type,target_min,target_max,unit,basis,target_period,document_id,page,relevant_quote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "guide",
    "FIXTURE.NS",
    "Revenue growth",
    "Source fixture",
    "range",
    3,
    5,
    "%",
    "Consolidated CC",
    "FY2026",
    "fixture",
    1,
    "Verified guidance 3 to 5 percent for FY2026",
  );
  assert.notEqual(revision(), beforeGuidance);
  const stable = revision();
  db.prepare("UPDATE documents SET title='Unrelated' WHERE id='other'").run();
  assert.equal(revision(), stable);
  db.prepare(
    "UPDATE guidance_statements SET target_max=6 WHERE id='guide'",
  ).run();
  assert.notEqual(revision(), stable);
  db.close();
});
test("explicit table grammar keeps columns, basis, units, signed outflows and restatement status", () => {
  const table = {
    page: 7,
    text: "Consolidated INR crore\nMetric | Q4 FY2026 | Q3 FY2026 (restated) | Q4 FY2025\nRevenue | 120 | 100 | 80\nPAT | 12 | 10 | 8\nEBITDA | 24 | 20 | 16\nPBT | 16 | 14 | 12\nCapex | (5) | 4 | 3\nNet profit | 3 | 2",
  };
  const r = extractExplicitTables([table]);
  assert.equal(r.metrics.length, 15);
  assert.equal(r.rejected.length, 1);
  assert.equal(
    r.metrics.find((m) => m.name === "Capital expenditure")?.value,
    -5,
  );
  assert.equal(
    r.metrics.find((m) => m.period === "Q3 FY2026")?.reporting_status,
    "restated",
  );
  assert.equal(
    extractExplicitTables([
      {
        ...table,
        text: table.text.replace("Consolidated", "Consolidated and Standalone"),
      },
    ]).metrics.length,
    0,
  );
});
test("task ranking considers all permitted links and preserves undated metadata rather than inventing dates", () => {
  const html = Array.from(
    { length: 6 },
    (_, i) =>
      `<a href="https://www.bseindia.com/${i}.pdf">${i === 5 ? "Annual Report FY2026" : i === 4 ? "Earnings call transcript" : "Quarterly results"}</a>`,
  ).join("");
  const c = parseCandidates(html, (u) =>
    u.startsWith("https://www.bseindia.com/"),
  ).candidates;
  assert.equal(c.length, 6);
  assert.ok(c.every((c) => c.published_at === null));
  assert.equal(rankCandidates(c, "balance sheet")[0].type, "annual_report");
  assert.equal(rankCandidates(c, "management guidance")[0].type, "transcript");
});
test("reasoning routing is optional and never changes extraction/classification routing", () => {
  const c = { GEMINI_MODEL_FAST: "fast", GEMINI_MODEL_REASONING: "reasoning" };
  assert.equal(
    modelForTask(c, "research", "guidance risk narrative"),
    "reasoning",
  );
  assert.equal(modelForTask(c, "extraction"), "fast");
  assert.equal(
    modelForTask({ GEMINI_MODEL_FAST: "fast" }, "research", "risk"),
    "fast",
  );
  assert.equal(aiStatus(c).enabled, false);
});
test("qualitative contradictions and omitted proposed qualifiers are rejected", () => {
  for (const [text, claim] of [
    [
      "Revenue declined by 15% in FY2026.",
      "Revenue increased by 15% in FY2026.",
    ],
    [
      "The proposed acquisition is subject to approval.",
      "The acquisition was completed.",
    ],
  ]) {
    assert.equal(
      verifyFinding(
        {
          claim,
          supporting_source_ids: ["S1"],
          evidence_excerpt: text,
          evidence_type: "reported",
          uncertainty_note: "",
        },
        "FIXTURE.NS",
        [
          {
            id: "S1",
            document_id: "fixture",
            ticker: "FIXTURE.NS",
            page: 1,
            text,
            period: "FY2026",
          },
        ],
        [],
      ),
      false,
    );
  }
});
test("timeout, rate-limit and malformed provider output never become accepted synthesis", async () => {
  const input = {
    ticker: "FIXTURE.NS",
    question: "What evidence?",
    sources: [],
    metrics: [],
    calculated: [],
  };
  for (const code of ["timeout", "rate_limited", "not_configured"])
    await assert.rejects(() =>
      analyzeCompanyResearch(
        async () => {
          throw new AiFailure(code);
        },
        "test",
        input,
      ),
    );
  await assert.rejects(() =>
    analyzeCompanyResearch(
      async () => ({ text: "not json", inputTokens: 1, outputTokens: 1 }),
      "test",
      input,
    ),
  );
});
test("Gemini cannot turn reported operating profit into EBITDA", async () => {
  const text = "Consolidated operating profit was INR 768 crores in Q4 FY2026.";
  const r = await extractFinancialMetrics(
    async () => ({
      text: JSON.stringify({
        metrics: [
          {
            name: "EBITDA",
            value: 768,
            period: "Q4 FY2026",
            unit: "INR crores",
            basis: "Consolidated reported",
            source_id: "S1",
            evidence_excerpt: text,
            value_text: "768",
          },
        ],
        guidance: [],
      }),
      inputTokens: 1,
      outputTokens: 1,
    }),
    "test",
    "FIXTURE.NS",
    [
      {
        id: "S1",
        document_id: "fixture",
        ticker: "FIXTURE.NS",
        page: 1,
        period: "Q4 FY2026",
        text,
      },
    ],
  );
  assert.equal(r.metrics.length, 0);
  assert.equal(r.rejected, 1);
});
test("official disclosure table dates belong to their own filing rows", () => {
  const html =
    '<table><tr><td>Oct 30, 2026</td><td>New plant commissioning</td><td><a href="/a.pdf">View/Download</a></td></tr><tr><td>Oct 29, 2026</td><td>Credit rating affirmed</td><td><a href="https://internal.invalid/b.pdf">View</a></td></tr></table>';
  const r = parseOfficialTable(
    html,
    "https://issuer.invalid/",
    "issuer.invalid",
    (u) => u.startsWith("https://issuer.invalid/"),
  );
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].published_at, "2026-10-30");
  assert.equal(r.candidates[0].title, "New plant commissioning");
});
test("NSE directory resolves names without guessing symbols or including non-equity series", () => {
  const csv =
    'SYMBOL,NAME OF COMPANY,SERIES\nONE,"One, Two Limited",EQ\nOTHER,Other Bank Limited,BE\nBANK,Other Bank Limited,EQ';
  assert.equal(parseNseDirectory(csv, "one two")[0].ticker, "ONE.NS");
  assert.deepEqual(
    parseNseDirectory(csv, "other bank").map((c) => c.ticker),
    ["BANK.NS"],
  );
  assert.equal(parseNseDirectory(csv, "unknown").length, 0);
});
test("database refuses guidance comparisons with mismatched unit/company and preserves original evidence", () => {
  const db = database();
  db.prepare("INSERT INTO document_chunks VALUES (?,?,?,?,?)").run(
    "fixture:1",
    "fixture",
    "FIXTURE.NS",
    1,
    "Isolated fixture guidance and actual evidence",
  );
  db.prepare(
    "INSERT INTO guidance_statements(id,ticker,metric,statement_text,guidance_type,target_min,target_max,unit,basis,target_period,document_id,page,relevant_quote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "g",
    "FIXTURE.NS",
    "Revenue growth",
    "Fixture guidance",
    "range",
    3,
    5,
    "%",
    "Consolidated CC",
    "FY2026",
    "fixture",
    1,
    "Fixture guidance",
  );
  db.prepare(
    "INSERT INTO financial_metrics(id,ticker,name,value,period,unit,basis,document_id,page,evidence_text) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "m",
    "FIXTURE.NS",
    "Revenue growth",
    4,
    "FY2026",
    "INR crore",
    "Consolidated CC",
    "fixture",
    1,
    "Fixture actual",
  );
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO guidance_comparisons(id,statement_id,metric_id,status,explanation,compared_at) VALUES (?,?,?,?,?,?)",
      )
      .run("c", "g", "m", "Within guidance", "Invalid fixture", "2026"),
  );
  db.prepare("UPDATE financial_metrics SET unit='%' WHERE id='m'").run();
  db.prepare(
    "INSERT INTO guidance_comparisons(id,statement_id,metric_id,status,explanation,compared_at) VALUES (?,?,?,?,?,?)",
  ).run("c", "g", "m", "Within guidance", "Compatible fixture", "2026");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
test("forward guidance uses its target year without mislabelling the earlier source document period", () => {
  const db = database();
  db.prepare("INSERT INTO document_chunks VALUES (?,?,?,?,?)").run(
    "old:1",
    "old",
    "FIXTURE.NS",
    1,
    "FY2026 revenue guidance is 3 to 5 percent, stated during FY2025.",
  );
  db.prepare(
    "INSERT INTO guidance_statements(id,ticker,metric,statement_text,guidance_type,target_min,target_max,unit,basis,target_period,document_id,page,relevant_quote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "forward",
    "FIXTURE.NS",
    "Revenue growth",
    "Isolated fixture",
    "range",
    3,
    5,
    "%",
    "Consolidated CC",
    "FY2026",
    "old",
    1,
    "FY2026 revenue guidance is 3 to 5 percent",
  );
  const p = passageQuery("FIXTURE.NS", "FY2026 revenue guidance", {
    period: "FY2026",
  });
  const rows = db.prepare(p.sql).all(...p.values);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period, "FY2025");
  assert.equal(rows[0].page, 1);
  db.close();
});
test("unified market/filing batches resume the same explicit company set without repeats", () => {
  const input = ["DDD.NS", "BBB.NS", "AAA.NS", "CCC.NS", "BBB.NS", "EEE.NS"];
  const first = companySyncBatch(input),
    second = companySyncBatch(input, first.next_cursor!);
  assert.deepEqual(first.batch, ["AAA.NS", "BBB.NS", "CCC.NS"]);
  assert.deepEqual(second.batch, ["DDD.NS", "EEE.NS"]);
  assert.equal(second.next_cursor, null);
  assert.equal(new Set([...first.batch, ...second.batch]).size, 5);
});
