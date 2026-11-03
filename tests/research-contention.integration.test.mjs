import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

// Mutates only an explicitly supplied isolated local acceptance database.
const base = process.env.FINN_TEST_URL;
const database = process.env.FINN_TEST_DB;
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Set FINN_TEST_URL to the isolated localhost test server.");
if (!database || !resolve(database).startsWith(resolve(".sites-runtime") + sep))
  throw new Error("FINN_TEST_DB must be inside this checkout's isolated .sites-runtime directory.");

test("a competing discovery lease keeps research queued, then resumes the same request after release", { timeout: 25000 }, async () => {
  const cookie = "finn_session=" + randomUUID();
  async function api(path, body) {
    const r = await fetch(base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await r.json();
    assert.equal(r.status, 200, JSON.stringify(result));
    return result;
  }
  await api("health");
  const db = new DatabaseSync(resolve(database));
  db.exec("PRAGMA busy_timeout=5000");
  const key = "sync:document_discovery:INFY.NS";
  const catalogueKey = "source-catalogue:INFY.NS";
  const prior = db.prepare("SELECT value FROM meta WHERE key=?").get(catalogueKey);
  const version = readFileSync("lib/ingestion/discovery.ts", "utf8").match(/DISCOVERY_VERSION = "([^"]+)"/)[1];
  try {
    // No network dependency: existing authentic seed documents supply the evidence.
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)").run(catalogueKey, JSON.stringify({at:new Date().toISOString(), version, result:{candidates:[],limitations:[]}}));
    db.prepare("INSERT OR REPLACE INTO job_locks(key,expires_at) VALUES (?,?)").run(key, new Date(Date.now()+180000).toISOString());
    const created = await api("research/jobs", {ticker:"INFY.NS", type:"results", question:"Explain the latest reported revenue growth using the original company financial results."});
    await api("research/jobs/"+created.id+"/advance", {});
    let state;
    for(let i=0;i<40;i++) {
      state=await api("research/jobs/"+created.id);
      if(state.status!=="running")break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(state.id, created.id);
    assert.equal(state.status,"queued");
    assert.equal(state.phase,"discovery");
    assert.equal(state.error,null);
    assert.match(state.detail,/Another request.*latest sources/);
    const explicit = await api("research/jobs", {ticker:"INFY.NS", type:"results", period:"FY2030", question:"Show reported financial results for FY2030 only, if verified source evidence exists."});
    await api("research/jobs/"+explicit.id+"/advance", {});
    let waiting;
    for(let i=0;i<40;i++) {
      waiting=await api("research/jobs/"+explicit.id);
      if(waiting.status!=="running")break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(waiting.status,"queued");
    assert.equal(waiting.phase,"discovery");
    assert.equal(waiting.error,null);
    assert.equal(waiting.result,null,"Waiting for a source never invents future-period figures.");
    db.prepare("DELETE FROM job_locks WHERE key=?").run(key);
    await api("research/jobs/"+created.id+"/advance", {});
    for(let i=0;i<50;i++) {
      state=await api("research/jobs/"+created.id);
      if(state.status!=="running")break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(state.id,created.id);
    assert.equal(state.status,"queued");
    assert.equal(state.phase,"analysis");
    assert.equal(state.error,null);
    assert.equal(state.result,null,"No synthesis success is fabricated by contention recovery.");
  } finally {
    db.prepare("DELETE FROM job_locks WHERE key=?").run(key);
    if(prior)db.prepare("UPDATE meta SET value=? WHERE key=?").run(prior.value,catalogueKey);
    else db.prepare("DELETE FROM meta WHERE key=?").run(catalogueKey);
    db.close();
  }
});
