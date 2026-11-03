import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw new Error("Localhost only");
const config = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    }),
);
const session = `finn_session=${randomUUID()}`;
async function api(path, body, admin = false) {
  const r = await fetch(base + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: session,
      "Content-Type": "application/json",
      ...(admin ? { Authorization: `Bearer ${config.ADMIN_TOKEN}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
test(
  "authentic same-page results and dividend retain separate event IDs after alternate-headline reimport",
  { skip: !config.ADMIN_TOKEN },
  async () => {
    const input = JSON.parse(
      readFileSync("docs/examples/infy-dividend.json", "utf8"),
    );
    const a = await api("admin/ingest-announcements", input, true),
      b = await api(
        "admin/ingest-announcements",
        {
          ...input,
          headline: "Infosys proposed final dividend — original disclosure",
        },
        true,
      );
    assert.equal(a.filing.id, b.filing.id);
    assert.equal(b.duplicates, 1);
    const results = await api("announcements/infy-fy25-results"),
      dividend = await api("announcements/" + a.filing.id);
    assert.notEqual(results.id, dividend.id);
    assert.equal(results.document_id, dividend.document_id);
    assert.equal(results.evidence_page, dividend.evidence_page);
    const digest = await api(
      "digest?mode=historical&start=2025-04-17&end=2025-04-17",
    );
    assert.ok(digest.events.some((e) => e.id === results.id));
    assert.ok(digest.events.some((e) => e.id === dividend.id));
    const alerts = (await api("alerts")).alerts;
    assert.ok(alerts.some((a) => a.id.includes(dividend.id)));
    assert.ok(alerts.some((a) => a.id.includes(results.id)));
  },
);
test(
  "new authentic NTPC source reaches personalized live briefing, source inspection and durable alert",
  { skip: !config.ADMIN_TOKEN },
  async () => {
    const input = JSON.parse(
      readFileSync("docs/examples/ntpc-capacity.json", "utf8"),
    );
    const { filing } = await api("admin/ingest-announcements", input, true);
    assert.equal(filing.category, "capex");
    const detail = await api("announcements/" + filing.id);
    assert.match(detail.source_url, /^https:\/\/ntpc\.co\.in\//);
    assert.ok(detail.score >= 50);
    const digest = await api(
      "digest?mode=live&start=2026-10-29&end=2026-10-30",
    );
    assert.ok(digest.events.some((e) => e.id === filing.id));
    const doc = await api("documents/" + filing.document_id);
    assert.ok(doc.pages.some((p) => p.text.includes("95.6")));
    const alerts = (await api("alerts")).alerts;
    assert.ok(alerts.some((a) => a.id.includes(filing.id)));
  },
);
test("announcement cursor and direct lookup preserve company and mode filters", async () => {
  let cursor,
    ids = [];
  do {
    const page = await api(
      `announcements?ticker=INFY.NS&mode=historical&limit=1${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    assert.ok(page.announcements.every((a) => a.ticker === "INFY.NS"));
    for (const a of page.announcements) {
      assert.ok(!ids.includes(a.id));
      ids.push(a.id);
      assert.equal((await api("announcements/" + a.id)).id, a.id);
    }
    cursor = page.next_cursor;
  } while (cursor);
  assert.ok(ids.length >= 2);
});
test("ticker, ordinary name and partial name search expose verified directory and library metadata", async () => {
  for (const q of [
    "INFY",
    "INFY.NS",
    "Infosys",
    "Asian Paints",
    "HDFC Bank",
    "Larsen",
  ]) {
    const r = await api("companies/search?q=" + encodeURIComponent(q));
    assert.ok(r.companies.length > 0, q);
    assert.ok(
      r.companies.every(
        (c) => c.exchange === "NSE" && Number.isInteger(c.indexed_documents),
      ),
    );
  }
  const r = await api("companies/search?q=Britannia%20Industries");
  assert.ok(r.companies.some((c) => c.ticker === "BRITANNIA.NS"));
});
