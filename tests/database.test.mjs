import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const migration = readFileSync(
  new URL("../drizzle/0000_nervous_tigra.sql", import.meta.url),
  "utf8",
);
test("duplicate filings are rejected by a database unique constraint", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO announcements(id,ticker,hash,document_id,date,payload) VALUES (?,?,?,?,?,?)",
  );
  insert.run(
    "test-only-a",
    "FICTIONAL.NS",
    "same-authentic-content-hash",
    "test-document",
    "2025-04-22",
    "{}",
  );
  insert.run(
    "test-only-b",
    "FICTIONAL.NS",
    "same-authentic-content-hash",
    "test-document",
    "2025-04-22",
    "{}",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n,
    1,
  );
  db.close();
});
test("watchlists remain isolated per owner and cannot duplicate a ticker", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO portfolio_companies(owner,ticker,created_at) VALUES (?,?,?)",
  );
  insert.run("test-owner-a", "FICTIONAL.NS", "2025-04-22");
  insert.run("test-owner-a", "FICTIONAL.NS", "2025-04-22");
  insert.run("test-owner-b", "OTHER-FICTIONAL.NS", "2025-04-22");
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM portfolio_companies WHERE owner=?")
      .get("test-owner-a").n,
    1,
  );
  assert.equal(
    db
      .prepare("SELECT ticker FROM portfolio_companies WHERE owner=?")
      .get("test-owner-a").ticker,
    "FICTIONAL.NS",
  );
  db.close();
});
test("live and historical observations never overwrite one another", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  const insert = db.prepare(
    "INSERT INTO daily_prices(ticker,date,close,adjusted_close,volume,source,retrieved_at,mode) VALUES (?,?,?,?,?,?,?,?)",
  );
  insert.run(
    "FICTIONAL.NS",
    "2025-04-22",
    100,
    50,
    1000,
    "isolated-test-only",
    "2025-04-22",
    "historical",
  );
  insert.run(
    "FICTIONAL.NS",
    "2025-04-22",
    101,
    51,
    1200,
    "isolated-test-only",
    "2025-04-22",
    "live",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_prices").get().n, 2);
  db.close();
});
