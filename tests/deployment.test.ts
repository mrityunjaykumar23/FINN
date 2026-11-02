import {
  revenueContext,
  financialLabelSupported,
} from "../lib/financial-labels.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { parseSource } from "../lib/ingestion/adapters.ts";
import {
  financialNumber,
  guidanceScale,
  guidanceTone,
  publicationLabel,
} from "../lib/presentation.ts";
import {
  publicationMetadata,
  extractionOutcome,
  processIndependentCandidates,
} from "../lib/pipeline-state.ts";
test("date-only CMS records stay date-only at the adapter; real offset times and missing dates remain distinct", () => {
  const config = {
    ticker: "MARUTI.NS",
    provider: "test",
    url: "https://www.marutisuzuki.com/",
    officialHost: "marutisuzuki.com",
    layout: "maruti_cms",
    note: "test",
  };
  const raw = JSON.stringify({
    data: {
      corporateDocumentsList: {
        items: [
          {
            title: "A",
            date: "2026-10-30",
            externalUrlLink: "https://www.marutisuzuki.com/a.pdf",
          },
          {
            title: "B",
            date: "2026-10-30T12:45:00+05:30",
            externalUrlLink: "https://www.marutisuzuki.com/b.pdf",
          },
          {
            title: "C",
            date: null,
            externalUrlLink: "https://www.marutisuzuki.com/c.pdf",
          },
          {
            title: "D",
            date: "2026-10-30T23:30:00-04:00",
            externalUrlLink: "https://www.marutisuzuki.com/d.pdf",
          },
          {
            title: "E",
            date: "2026-10-30T12:45:00",
            externalUrlLink: "https://www.marutisuzuki.com/e.pdf",
          },
        ],
      },
    },
  });
  const rows = parseSource(config, raw, () => true);
  assert.equal(rows[0].publication_precision, "date");
  assert.equal(rows[0].source_timestamp, null);
  assert.equal(rows[1].publication_precision, "company_recorded_datetime");
  assert.equal(rows[1].publication_timezone, "Asia/Kolkata");
  assert.equal(rows[2].publication_precision, "unknown");
  assert.equal(rows[2].published_at, null);
  assert.equal(rows[3].published_at, "2026-10-30");
  assert.equal(rows[3].publication_timezone, "-04:00");
  assert.equal(rows[4].publication_precision, "date");
});
test("ITC adapter pairs each original PDF with its own date and rejects neighbouring date inheritance", () => {
  const config = {
    ticker: "ITC.NS",
    provider: "official_itc_disclosures",
    url: "https://itcportal.com/investors/stock-exchange-announcements.html",
    officialHost: "itcportal.com",
    layout: "itc_cards",
    note: "test",
  };
  const card = (title: string, date: string, url: string) =>
    `<div class="group_doc_list_box link--clicks-link-parent"><a href="${url}"></a>${date ? `<div class="group_doc_heading_date">${date}</div>` : ""}<ul><li><div class="group_doc_title">${title}</div></li></ul></div></section>`;
  const rows = parseSource(
    config,
    card(
      "Notice of Board Meeting",
      "Oct 16, 2026",
      "/content/dam/itc-corporate/stock-exchange-/2026/lodr-16oct26.pdf",
    ) +
      card(
        "Acquisition of shares of Sproutlife Foods Private Limited",
        "Sep 28, 2026",
        "/content/dam/itc-corporate/stock-exchange-/2026/lodr-28sep26.pdf",
      ) +
      card("Undated", "", "/unknown.pdf"),
    (u) => new URL(u).hostname === "itcportal.com",
  );
  assert.equal(rows[0].published_at, "2026-10-16");
  assert.equal(rows[1].published_at, "2026-09-28");
  assert.equal(rows[2].published_at, null);
  assert.ok(
    rows.every((r) => r.publication_precision !== "company_recorded_datetime"),
  );
});
test("reported decimals and missing values retain financial meaning in the premium presentation", () => {
  assert.equal(financialNumber(48.4), "48.4");
  assert.equal(financialNumber(1465.25), "1,465.25");
  assert.equal(financialNumber(0), "0");
  assert.equal(financialNumber(null), "Unavailable");
  const scale = guidanceScale(4.5, 5, 4.2);
  assert.ok(scale.actual < scale.start);
  assert.ok(scale.min < 4.2 && scale.max > 5);
  assert.equal(guidanceTone("Superseded guidance", 0.2), "neutral");
  assert.equal(guidanceTone("Below guidance", -0.3), "critical");
  assert.equal(guidanceTone("Within guidance", 0), "verified");
});
test("a precise publication crosses calendar days consistently when displayed in IST", () => {
  const label = publicationLabel({
    date: "2026-10-30",
    published_at: "2026-10-30T23:30:00-04:00",
    publication_precision: "company_recorded_datetime",
  });
  assert.match(label, /31 Oct 2026/);
  assert.match(label, /09:00/);
  assert.match(label, /IST/);
  assert.equal(
    publicationLabel({ date: "2026-10-30" }),
    "30 Oct 2026 · date only",
  );
});
test("publication precision follows a real source timestamp and date-only never implies a clock time", () => {
  const date = publicationMetadata({
    date: "2026-10-09",
    published_at: "2026-10-09",
  });
  assert.equal(date.publication_precision, "date");
  assert.equal(date.published_at, "2026-10-09");
  assert.match(date.date_precision, /date only/i);
  const time = publicationMetadata({
    date: "2026-10-09",
    publication_precision: "company_recorded_datetime",
    published_at: "2026-10-09T15:46:00.000+05:30",
    publication_timezone: "Asia/Kolkata",
  });
  assert.equal(time.publication_precision, "company_recorded_datetime");
  assert.match(time.date_precision, /Company-recorded/);
  assert.equal(time.published_at, "2026-10-09T15:46:00.000+05:30");
  assert.equal(
    publicationMetadata({
      date: "2026-10-09",
      publication_precision: "company_recorded_datetime",
      published_at: "2026-10-09",
    }).publication_precision,
    "date",
  );
});
test("PDF indexing is never completed financial extraction after provider failure", () => {
  assert.equal(
    extractionOutcome(
      { status: "gemini_extraction_failed", metrics: 2 },
      "results",
    ).status,
    "extraction_failed",
  );
  assert.equal(
    extractionOutcome({ status: "extraction_failed" }, "transcript", 3).status,
    "manual_required",
  );
  assert.equal(
    extractionOutcome(
      { status: "source_checked", metrics: 0, guidance: 0 },
      "annual_report",
    ).status,
    "manual_required",
  );
  assert.equal(
    extractionOutcome({ status: "source_checked", metrics: 3 }, "results")
      .status,
    "complete",
  );
  assert.equal(
    extractionOutcome({ status: "no_relevant_text" }, "announcement").status,
    "complete",
  );
});
test("an independent blocked candidate does not interrupt subsequent candidates", async () => {
  const processed: number[] = [],
    failed: number[] = [];
  await processIndependentCandidates(
    [1, 2, 3],
    async (id) => {
      if (id === 1) throw new Error("HTTP 406");
      processed.push(id);
    },
    async (id) => {
      failed.push(id);
    },
  );
  assert.deepEqual(processed, [2, 3]);
  assert.deepEqual(failed, [1]);
});

test("an omitted revenue heading can be included only as exact adjacent source context", () => {
  const quote = "In Q4 we were at INR 4,686 crores.";
  const page =
    "Absolute revenue over the last four years. Consolidated results: " + quote;
  assert.equal(
    revenueContext(page, quote),
    page.slice(page.indexOf("revenue")),
  );
  assert.equal(
    revenueContext(
      "Revenue trends. Total income was INR 1465 crore.",
      "Total income was INR 1465 crore.",
    ),
    undefined,
  );
  assert.equal(
    revenueContext("Revenue was 10. Profit before tax: " + quote, quote),
    undefined,
  );
  assert.equal(
    financialLabelSupported("Revenue", "Reported revenues of INR 10 crore."),
    true,
  );
});

// The two public research routes build filter objects in different orders.
import { canonicalResearchFilters } from "../lib/research-filters.ts";
test("research cache identity ignores filter construction order and absent values", () => {
  const durable = canonicalResearchFilters({
    type: "transcript",
    period: "Q2 FY2027",
  });
  const legacy = canonicalResearchFilters({
    period: "Q2 FY2027",
    type: "transcript",
  });
  assert.equal(JSON.stringify(durable), JSON.stringify(legacy));
  assert.deepEqual(
    canonicalResearchFilters({ period: undefined, type: "results" }),
    { type: "results" },
  );
});
