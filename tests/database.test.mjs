import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const old = readFileSync(
  new URL("../drizzle/0000_nervous_tigra.sql", import.meta.url),
  "utf8",
);
const upgrade = readFileSync(
  new URL("../drizzle/0001_integrity.sql", import.meta.url),
  "utf8",
);
const finalMigration = readFileSync(
  new URL("../drizzle/0002_tired_lady_vermin.sql", import.meta.url),
  "utf8",
);
const seed = JSON.parse(
  readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"),
);
function legacy(db) {
  db.exec(old);
  for (const c of seed.companies)
    db.prepare("INSERT INTO companies VALUES (?,?,?,?,?)").run(
      c.ticker,
      c.name,
      c.sector,
      c.validation,
      c.updated_at ?? "2025",
    );
  for (const d of seed.documents) {
    db.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      d.id,
      d.ticker,
      d.title,
      d.type,
      d.period,
      d.url,
      d.published_at,
      d.retrieved_at,
      d.hash,
      d.mode,
    );
    for (const p of d.pages)
      db.prepare("INSERT INTO document_chunks VALUES (?,?,?,?,?)").run(
        `${d.id}:${p.page}`,
        d.id,
        d.ticker,
        p.page,
        p.text,
      );
  }
  for (const m of seed.metrics)
    db.prepare("INSERT INTO financial_metrics VALUES (?,?,?,?,?,?,?,?,?)").run(
      m.id,
      m.ticker,
      m.name,
      m.value,
      m.period,
      m.unit,
      m.basis,
      m.document_id,
      m.page,
    );
  for (const f of seed.events)
    db.prepare("INSERT INTO announcements VALUES (?,?,?,?,?,?)").run(
      f.id,
      f.ticker,
      f.id,
      f.document_id,
      f.date,
      JSON.stringify(f),
    );
  db.prepare("INSERT INTO portfolio_companies VALUES (?,?,?)").run(
    "visitor-a",
    "INFY.NS",
    "2025",
  );
  db.prepare("INSERT INTO portfolio_companies VALUES (?,?,?)").run(
    "visitor-b",
    "HCLTECH.NS",
    "2025",
  );
  db.prepare("INSERT INTO alert_preferences VALUES (?,?)").run(
    "visitor-a",
    JSON.stringify({ price_threshold: 6 }),
  );
  db.prepare("INSERT INTO meta VALUES (?,?)").run(
    "owner:empty-visitor",
    "initialized",
  );
}
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  legacy(db);
  db.exec(upgrade);
  db.exec(finalMigration);
  db.exec(
    readFileSync(
      new URL("../drizzle/0003_bumpy_marten_broadcloak.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL("../drizzle/0004_flimsy_deathbird.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL("../drizzle/0005_parallel_outlaw_kid.sql", import.meta.url),
      "utf8",
    ),
  );
  return db;
}
test("incremental migration works on empty database with enforced foreign keys", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(old);
  db.exec(upgrade);
  db.exec(finalMigration);
  db.exec(
    readFileSync(
      new URL("../drizzle/0003_bumpy_marten_broadcloak.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL("../drizzle/0004_flimsy_deathbird.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL("../drizzle/0005_parallel_outlaw_kid.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
test("migration preserves historical sources, custom portfolios, settings and empty visitor initialization", () => {
  const db = fixture();
  assert.equal(
    db.prepare("SELECT count(*) n FROM documents").get().n,
    seed.documents.length,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM financial_metrics").get().n,
    seed.metrics.length,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM portfolio_companies").get().n,
    2,
  );
  assert.equal(
    JSON.parse(
      db
        .prepare("SELECT settings FROM alert_preferences WHERE owner=?")
        .get("visitor-a").settings,
    ).price_threshold,
    6,
  );
  assert.ok(
    db
      .prepare("SELECT initialized_at FROM owners WHERE id=?")
      .get("empty-visitor").initialized_at,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
test("foreign keys reject orphaned or cross-company evidence", () => {
  const db = fixture();
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO portfolio_companies VALUES (?,?,?)")
        .run("missing", "INFY.NS", "2025"),
    /FOREIGN KEY|source page/,
  );
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO document_chunks VALUES (?,?,?,?,?)")
        .run("wrong-ticker", "infy-results", "TCS.NS", 1, "unsupported"),
    /FOREIGN KEY|source page/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO financial_metrics(id,ticker,name,value,period,unit,basis,document_id,page) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "bad",
          "TCS.NS",
          "Revenue",
          1,
          "FY2025",
          "INR crore",
          "Consolidated",
          "infy-results",
          1,
        ),
    /FOREIGN KEY|source page/,
  );
  db.close();
});
test("portfolio removal is owner-isolated and preserves shared evidence", () => {
  const db = fixture();
  db.prepare("DELETE FROM portfolio_companies WHERE owner=?").run("visitor-a");
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM portfolio_companies WHERE owner=?")
      .get("visitor-a").n,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM portfolio_companies WHERE owner=?")
      .get("visitor-b").n,
    1,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM documents").get().n,
    seed.documents.length,
  );
  assert.throws(
    () => db.prepare("DELETE FROM companies WHERE ticker=?").run("INFY.NS"),
    /FOREIGN KEY|source page/,
  );
  db.close();
});
test("unique company, filing and market ingestion; live observations coexist with replay", () => {
  const db = fixture();
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO companies VALUES (?,?,?,?,?)")
        .run("INFY.NS", "dup", "x", "x", "x"),
    /UNIQUE/,
  );
  const f = seed.events[0];
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO announcements(id,ticker,hash,document_id,date,payload) VALUES (?,?,?,?,?,?)",
        )
        .run(
          "duplicate",
          f.ticker,
          f.id,
          f.document_id,
          f.date,
          JSON.stringify(f),
        ),
    /UNIQUE/,
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO daily_prices VALUES (?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 2; i++)
    for (const mode of ["live", "historical"])
      insert.run(
        "INFY.NS",
        "2025-04-22",
        100,
        99,
        1000,
        "authentic-fixture-only",
        "2025",
        mode,
      );
  assert.equal(db.prepare("SELECT count(*) n FROM daily_prices").get().n, 2);
  db.close();
});
test("FTS is synchronized on insert/update/delete without losing page tracking", () => {
  const db = fixture();
  db.prepare("INSERT INTO document_chunks VALUES (?,?,?,?,?)").run(
    "fts-check",
    "infy-results",
    "INFY.NS",
    1,
    "isolatedsearchword",
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM chunks_fts WHERE chunks_fts MATCH 'isolatedsearchword'",
      )
      .get().n,
    1,
  );
  db.prepare("DELETE FROM document_chunks WHERE id=?").run("fts-check");
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM chunks_fts WHERE chunks_fts MATCH 'isolatedsearchword'",
      )
      .get().n,
    0,
  );
  db.close();
});
test("guidance, metrics, caches and notification lifecycle survive database reopen", () => {
  const folder = mkdtempSync(join(tmpdir(), "finn-durable-")),
    path = join(folder, "state.sqlite");
  let db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON");
  legacy(db);
  db.exec(upgrade);
  db.exec(finalMigration);
  db.exec(
    readFileSync(
      new URL("../drizzle/0003_bumpy_marten_broadcloak.sql", import.meta.url),
      "utf8",
    ),
  );
  db.prepare(
    "INSERT INTO guidance_statements(id,ticker,metric,statement_text,guidance_type,target_min,target_max,unit,basis,target_period,document_id,page,relevant_quote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "persist-guidance",
    "INFY.NS",
    "Revenue growth",
    "explicit test statement",
    "range",
    4.5,
    5,
    "%",
    "Consolidated constant currency",
    "FY2025",
    "infy-call-q3",
    7,
    "existing source",
  );
  db.prepare(
    "INSERT INTO analysis_cache(key,payload,created_at) VALUES (?,?,?)",
  ).run("durable-cache", '{"answer":"test-only"}', "2025");
  db.prepare(
    "INSERT INTO alerts(id,owner,payload,triggered_at,status,read_at) VALUES (?,?,?,?,?,?)",
  ).run("durable-alert", "visitor-a", "{}", "2025", "read", "2025");
  db.close();
  db = new DatabaseSync(path);
  assert.equal(
    db.prepare("SELECT count(*) n FROM guidance_statements").get().n,
    1,
  );
  assert.equal(db.prepare("SELECT status FROM alerts").get().status, "read");
  assert.equal(db.prepare("SELECT count(*) n FROM analysis_cache").get().n, 1);
  assert.equal(
    db.prepare("SELECT count(*) n FROM document_chunks").get().n,
    seed.documents.reduce((n, d) => n + d.pages.length, 0),
  );
  db.close();
  assert.ok(
    folder.startsWith(join(tmpdir(), "finn-durable-")),
    "Cleanup must remain inside the test temporary directory",
  );
  rmSync(folder, { recursive: true });
});
test("malformed JSON and invalid price observations fail constraints", () => {
  const db = fixture();
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO analysis_cache(key,payload,created_at) VALUES (?,?,?)",
        )
        .run("bad", "not-json", "2025"),
    /CHECK/,
  );
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?,?)")
        .run("INFY.NS", "2025", -1, 1, 1, "test", "2025", "live"),
    /CHECK/,
  );
  db.close();
});
