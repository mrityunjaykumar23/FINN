import { DatabaseSync } from 'node:sqlite';
import { readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const folder = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
mkdirSync('.sites-runtime/backups', {recursive:true});
for (const name of readdirSync(folder).filter(n => n.endsWith('.sqlite') && n !== 'metadata.sqlite')) {
  const db = new DatabaseSync(resolve(folder,name));
  const output = resolve('.sites-runtime/backups',`${Date.now()}-${name}`);
  db.exec(`VACUUM INTO '${output.replaceAll("'", "''")}'`);
  db.close();
  console.log(`SQLite snapshot: ${output}`);
}
