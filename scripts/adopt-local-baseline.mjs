// For pre-journal checkouts only. Verify every v0 column before recording v0 as applied.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const reference=new DatabaseSync(':memory:');
reference.exec(readFileSync('drizzle/0000_nervous_tigra.sql','utf8'));
const tables=reference.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
const folder=resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
for(const name of readdirSync(folder).filter(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')) {
  const db=new DatabaseSync(resolve(folder,name));
  const journal=db.prepare("SELECT name FROM sqlite_master WHERE name='d1_migrations'").get();
  if(!journal)throw new Error('Run Wrangler migrations once to initialize its ledger first.');
  if(db.prepare('SELECT 1 FROM d1_migrations LIMIT 1').get()){db.close();continue;}
  for(const table of tables) {
    const signature=d=>JSON.stringify(d.prepare(`PRAGMA table_info('${table}')`).all());
    if(signature(db)!==signature(reference))throw new Error(`Baseline mismatch in ${table}; not adopting.`);
  }
  db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run('0000_nervous_tigra.sql');
  console.log('Verified existing v0 schema; recorded baseline without modifying financial or visitor data.');db.close();
}
reference.close();
