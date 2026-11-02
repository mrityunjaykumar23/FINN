import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.FINN_TEST_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))
  throw Error("Local mutation tests only");
async function req(path, cookie, body) {
  const r = await fetch(base + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
test(
  "durable research returns promptly, isolates owners, safely deduplicates and completes from stored primary evidence",
  { timeout: 90000 },
  async () => {
    const a = `finn_session=${randomUUID()}`,
      b = `finn_session=${randomUUID()}`;
    const input = {
      ticker: "INFY.NS",
      question:
        "For FY2025 compare the reported constant currency revenue growth with January guidance, using original source pages.",
      period: "FY2025",
    };
    const start = performance.now(),
      created = await req("research/jobs", a, input);
    assert.equal(created.status, 200);
    assert.ok(
      performance.now() - start < 5000,
      "Creation blocked on research instead of returning a durable status",
    );
    assert.equal(created.data.status, "queued");
    assert.equal(created.data.owner_id, undefined);
    const id = created.data.id;
    assert.equal((await req("research/jobs", a, input)).data.id, id);
    assert.equal((await req(`research/jobs/${id}`, b)).status, 404);
    assert.equal((await req(`research/jobs/${id}/advance`, b, {})).status, 404);
    let state = created.data;
    for (let i = 0; i < 65 && state.status !== "complete"; i++) {
      assert.notEqual(state.status, "failed", state.error);
      if (state.status === "queued")
        assert.equal(
          (await req(`research/jobs/${id}/advance`, a, {})).status,
          200,
        );
      await new Promise((r) => setTimeout(r, 750));
      state = (await req(`research/jobs/${id}`, a)).data;
    }
    assert.equal(state.status, "complete", JSON.stringify(state));
    assert.equal(state.result.ticker, "INFY.NS");
    assert.ok(state.result.source_references.length > 0);
    assert.equal(
      (await req(`research/jobs/${id}/advance`, a, {})).data.status,
      "complete",
    );
    assert.equal(
      (await req(`research/jobs/${id}`, a)).data.result.summary,
      state.result.summary,
    );
  },
);
