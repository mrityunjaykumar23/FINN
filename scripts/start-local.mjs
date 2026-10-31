import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
// Wrangler resolves secrets relative to its built config. Pass the root file explicitly.
// These bindings are loaded as secret_text, never browser variables or config values.
const extra = process.argv.slice(2),
  cli = resolve("node_modules/wrangler/bin/wrangler.js");
process.env.SITES_RUNTIME_ROOT ??= resolve(".sites-runtime/production-preview");
await import("./sites-env.mjs");
process.argv = [
  process.execPath,
  cli,
  "dev",
  "--config",
  resolve("dist/server/wrangler.json"),
  "--local",
  ...(!extra.includes("--name")
    ? ["--name", "finn-local-production-preview"]
    : []),
  ...(!extra.includes("--persist-to")
    ? ["--persist-to", resolve(".wrangler/state")]
    : []),
  "--ip",
  "127.0.0.1",
  "--inspector-port",
  "0",
  ...(existsSync(".dev.vars") ? ["--env-file", resolve(".dev.vars")] : []),
  ...extra,
];
const result = spawnSync(process.execPath, process.argv.slice(1), {
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
