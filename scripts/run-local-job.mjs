// Credentials are read locally, never placed in shell arguments or printed.
import { readFileSync } from "node:fs";
const config = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    }),
);
const action = process.argv[2] ?? "evaluate";
const file = process.argv.slice(3).find((a) => !a.startsWith("--"));
const input = file ? JSON.parse(readFileSync(file, "utf8")) : {};
const paths = {
  jobs: "admin/document-jobs",
  evaluate: "admin/evaluate-alerts?mode=live",
  replay: "admin/evaluate-alerts?mode=historical",
  sync: "admin/sync-intelligence",
  "sync-announcements": "admin/sync-announcements",
  discovery: "admin/sync-announcements",
  ingestion: "admin/sync-announcements",
  retry: "admin/process-document-jobs",
  documents: "admin/discover-documents",
  filing: "admin/ingest-announcements",
  market: "admin/ingest-market",
  document: "admin/ingest-document",
  extract: "admin/extract-document",
};
if (!paths[action])
  throw new Error(
    "Choose evaluate, replay, sync, sync-announcements, discovery, ingestion, documents, retry, filing, market, document or extract.",
  );
if (!config.ADMIN_TOKEN)
  throw new Error("Configure ADMIN_TOKEN locally first.");
const { mkdirSync, existsSync, writeFileSync } = await import("node:fs");
mkdirSync(".sites-runtime/jobs", { recursive: true });
const checkpoint = `.sites-runtime/jobs/${action}.json`;
let state =
  process.argv.includes("--resume") && existsSync(checkpoint)
    ? JSON.parse(readFileSync(checkpoint, "utf8"))
    : {
        input,
        after: input.after,
        owner_after: input.owner_after,
        complete: false,
      };
const base = process.env.FINN_BASE_URL ?? "http://127.0.0.1:5173";
if (!/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(base))
  throw new Error("Local job runner only accepts a localhost URL.");
const maxCalls = process.argv.includes("--drain") ? 30 : 1;
for (let call = 0; call < maxCalls; call++) {
  if (state.complete) {
    console.log(JSON.stringify({ complete: true, checkpoint }));
    break;
  }
  const payload = {
    ...state.input,
    after: state.after,
    owner_after: state.owner_after,
    ...(["discovery", "ingestion"].includes(action)
      ? { stage: action, evaluate: false }
      : {}),
  };
  const response = await fetch(`${base}/api/${paths[action]}`, {
    method: action === "jobs" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${config.ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(action === "jobs" ? {} : { body: JSON.stringify(payload) }),
  });
  const result = await response.json();
  console.log(JSON.stringify({ http_status: response.status, result }));
  if (!response.ok) {
    process.exitCode = 1;
    break;
  }
  const batch = result.announcements ?? result;
  // Finish every owner page before advancing the company batch. Stages can also run independently.
  const ownerNext = batch.alerts?.next_owner_cursor ?? batch.next_owner_cursor;
  if (ownerNext) state.owner_after = ownerNext;
  else {
    state.owner_after = undefined;
    state.after = batch.next_company_cursor ?? undefined;
    state.complete = !state.after;
  }
  if (
    action === "retry" &&
    result.results?.length &&
    result.counts?.some(
      (c) => ["pending", "failed"].includes(c.status) && c.n > 0,
    )
  )
    state.complete = false;
  state.updated_at = new Date().toISOString();
  writeFileSync(checkpoint, JSON.stringify(state, null, 2));
}
