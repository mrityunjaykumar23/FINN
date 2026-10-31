import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const config = existsSync(".dev.vars")
  ? Object.fromEntries(
      readFileSync(".dev.vars", "utf8")
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
        }),
    )
  : {};
test(
  "simultaneous authentic filing imports create one source-page event",
  {
    skip: !config.ADMIN_TOKEN
      ? "Configure local ADMIN_TOKEN for the opt-in ingestion test"
      : false,
  },
  async () => {
    const base = "http://127.0.0.1:5173/api/",
      input = JSON.parse(readFileSync("docs/examples/dmart-q3.json", "utf8"));
    const importOne = async (headline) => {
      const r = await fetch(base + "admin/ingest-announcements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ ...input, headline }),
      });
      return { status: r.status, data: await r.json() };
    };
    const results = await Promise.all([
      importOne(input.headline),
      importOne(input.headline + " — primary disclosure"),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    assert.ok(results.every((r) => r.status === 200 || r.status === 409));
    const announcements = await (
      await fetch(
        base + "announcements?ticker=DMART.NS&start=2025-01-11&end=2025-01-11",
      )
    ).json();
    const matching = announcements.announcements.filter(
      (f) => f.evidence_page === input.evidence_page && f.date === input.date,
    );
    assert.equal(matching.length, 1);
    assert.equal(matching[0].category, "results");
    const document = await (
      await fetch(base + "documents/" + matching[0].document_id)
    ).json();
    assert.equal(document.ticker, "DMART.NS");
    assert.equal(document.url, input.url);
    assert.ok(
      document.pages.some(
        (p) => p.page === input.evidence_page && p.text.includes("15,565"),
      ),
    );
  },
);
