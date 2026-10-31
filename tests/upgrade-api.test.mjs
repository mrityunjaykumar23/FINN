import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw new Error("Upgrade mutation tests are restricted to localhost.");
const cookie = () => `finn_session=${randomUUID()}`;
async function req(path, session, method = "GET", data, headers = {}) {
  const r = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      Cookie: session,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  const text = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: text };
  }
  return { status: r.status, data: parsed, headers: r.headers };
}
test("simultaneous first requests initialize once; spoofed identity headers are ignored", async () => {
  const a = cookie(),
    b = cookie();
  const requests = await Promise.all(
    Array.from({ length: 8 }, () =>
      req("portfolio", a, "GET", undefined, {
        "oai-authenticated-user-id": "spoofed-shared-user",
      }),
    ),
  );
  assert.ok(
    requests.every((r) => r.status === 200 && r.data.companies.length === 18),
  );
  assert.match(requests[0].headers.get("set-cookie"), /HttpOnly/);
  await req("portfolio/INFY.NS", a, "DELETE");
  assert.equal((await req("portfolio", a)).data.companies.length, 17);
  assert.equal(
    (
      await req("portfolio", b, "GET", undefined, {
        "oai-authenticated-user-id": "spoofed-shared-user",
      })
    ).data.companies.length,
    18,
  );
});
test("removing the entire starter portfolio persists; another visitor keeps sources and selections", async () => {
  const a = cookie(),
    b = cookie(),
    p = (await req("portfolio", a)).data.companies;
  for (const c of p)
    assert.equal((await req(`portfolio/${c.ticker}`, a, "DELETE")).status, 200);
  for (let i = 0; i < 2; i++)
    assert.equal((await req("portfolio", a)).data.companies.length, 0);
  assert.equal((await req("portfolio", b)).data.companies.length, 18);
  assert.equal((await req("documents/infy-results", a)).status, 200);
});
test("read and dismissed alerts survive repeated evaluation and remain owner isolated", async () => {
  const a = cookie(),
    b = cookie();
  await req("digest?days=7", a);
  const first = (await req("alerts", a)).data.alerts;
  assert.ok(first.length);
  const id = first[0].id;
  assert.equal(
    (
      await req(`alerts/${encodeURIComponent(id)}`, a, "PATCH", {
        status: "read",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req(`alerts/${encodeURIComponent(id)}`, b, "PATCH", {
        status: "dismissed",
      })
    ).status,
    404,
  );
  await req("digest?days=7", a);
  const second = (await req("alerts", a)).data.alerts;
  assert.equal(second.length, first.length);
  assert.equal(second.find((x) => x.id === id).status, "read");
  assert.ok(second.find((x) => x.id === id).read_at);
  await req(`alerts/${encodeURIComponent(id)}`, a, "PATCH", {
    status: "dismissed",
  });
  await req("alerts/evaluate", a, "POST", {});
  assert.equal(
    (await req("alerts?status=dismissed", a)).data.alerts.find(
      (x) => x.id === id,
    ).status,
    "dismissed",
  );
});
test("unavailable requested fiscal period does not reuse FY2025 guidance or invented sources", async () => {
  const r = await req("research", cookie(), "POST", {
    ticker: "INFY.NS",
    question: "What did management deliver in FY2099?",
    period: "FY2099",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.key_findings.length, 0);
  assert.equal(r.data.source_references.length, 0);
  assert.match(r.data.summary, /Insufficient/);
});
test("source status reports actual persisted coverage and no configuration secrets", async () => {
  const r = await req("status", cookie());
  assert.equal(r.status, 200);
  assert.ok(r.data.counts.documents >= 11);
  assert.ok(r.data.counts.guidance >= 2);
  assert.equal(JSON.stringify(r.data).includes("GEMINI_API_KEY"), false);
  assert.equal(JSON.stringify(r.data).includes("ADMIN_TOKEN"), false);
});
test("cross-origin writes and oversized streamed JSON are controlled errors", async () => {
  assert.equal(
    (
      await req(
        "portfolio",
        cookie(),
        "POST",
        { ticker: "INFY.NS" },
        { Origin: "https://untrusted.example" },
      )
    ).status,
    403,
  );
  const r = await req("research", cookie(), "POST", {
    ticker: "INFY.NS",
    question: "x".repeat(51000),
  });
  assert.equal(r.status, 413);
});
