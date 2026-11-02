import {
  revenueContext,
  financialLabelSupported,
} from "../lib/financial-labels.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  publicationMetadata,
  extractionOutcome,
  processIndependentCandidates,
} from "../lib/pipeline-state.ts";
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
