import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
fs.mkdirSync(".sites-runtime", {recursive:true});
// Wrangler owns the local migration journal, making repeated runs safe.
const config=path.resolve(".sites-runtime/local-migrations.json");
fs.writeFileSync(config,JSON.stringify({name:"finn-local-migrations",compatibility_date:"2026-05-15",d1_databases:[{binding:"DB",database_name:"site-creator-d1",database_id:"00000000-0000-4000-8000-000000000000",migrations_dir:path.resolve("drizzle")}]}));
const result=spawnSync(process.execPath,["--import","./scripts/sites-env.mjs","./node_modules/wrangler/bin/wrangler.js","d1","migrations","apply","DB","--local","--config",config,"--persist-to",".wrangler/state"],{stdio:"inherit"});
process.exit(result.status??1);
