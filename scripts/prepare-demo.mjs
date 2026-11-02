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
if (!config.ADMIN_TOKEN)
  throw new Error("Configure ADMIN_TOKEN locally first.");
const base = process.env.FINN_BASE_URL ?? "http://127.0.0.1:5173";
const response = await fetch(base + "/api/admin/prepare-demo", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
console.log(
  JSON.stringify(
    { status: response.status, result: await response.json() },
    null,
    2,
  ),
);
if (!response.ok) process.exitCode = 1;
