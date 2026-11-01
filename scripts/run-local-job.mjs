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
const action = process.argv[2] ?? "evaluate",
  input = process.argv[3]
    ? JSON.parse(readFileSync(process.argv[3], "utf8"))
    : {};
const paths = {
  evaluate: "admin/evaluate-alerts?mode=live",
  sync: "admin/sync-intelligence",
  "sync-announcements": "admin/sync-announcements",
  replay: "admin/evaluate-alerts?mode=historical",
  filing: "admin/ingest-announcements",
  market: "admin/ingest-market",
  document: "admin/ingest-document",
  extract: "admin/extract-document",
};
if (!paths[action])
  throw new Error(
    "Choose evaluate, replay, filing, market, document or extract. Optional argument: JSON input file.",
  );
if (!config.ADMIN_TOKEN)
  throw new Error("Configure ADMIN_TOKEN in .dev.vars first.");
const response = await fetch(`http://127.0.0.1:5173/api/${paths[action]}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(
    input,
  ),
});
console.log(
  JSON.stringify(
    { status: response.status, result: await response.json() },
    null,
    2,
  ),
);
if (!response.ok) process.exitCode = 1;
