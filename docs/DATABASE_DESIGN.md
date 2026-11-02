# SQLite design and safe migration

The database is SQLite locally and SQLite-compatible D1 in the retained hosted architecture. `db/repository.ts` isolates runtime binding access. All user values are parameters; table/column identifiers are authored constants.

## Migration sequence

1. `0000_nervous_tigra.sql`: original published schema, unchanged.
2. `0001_integrity.sql`: rebuilds existing tables with data-preserving copies and foreign keys; backfills owner records and normalized announcement/metric fields. Adds guidance, ingestion/source sync, budgets, AI operations, concurrency locks, FTS5 and query indexes. Existing personal associations and settings survive.
3. `0002_tired_lady_vermin.sql`: ticker/mode/date market index, legacy alert field backfill and triggers requiring genuine indexed pages for metrics/guidance; referenced evidence pages cannot be removed.
4. `0003_bumpy_marten_broadcloak.sql`: source-period provenance and derived comparisons referencing both original metrics.

5. `0004_flimsy_deathbird.sql`: separate event signatures/exchange identities, stable feed index, company revision counters and triggers, discovery candidates, extraction audit, restatement metadata, and source-sync counts/cursor. Existing event IDs are retained.
6. `0005_parallel_outlaw_kid.sql`: compatible-actual lookup index and database triggers refusing incomparable guidance/derived metric references.

7. `0006_stiff_enchantress.sql`: source discovery/processing provenance, source/run progress details, retry/manual-review counters and durable bounded `document_jobs`.
8. `0007_wandering_thor.sql`: retain the exact optional company-recorded source timestamp independently of the calendar publication date.

9. `0008_orange_winter_soldier.sql`: separate document-job extraction status/result from text indexing.
10. `0009_brave_the_stranger.sql`: add only the `research_jobs` table and owner/time index, with foreign keys to existing owners, companies and optional document jobs. No existing table is rebuilt or cleared.

The redesign also applies idempotent, audited data corrections: unsupported automatically inferred events are retained for review, recoverable stitched excerpts are expanded to contiguous original-page passages, and call/recording/newspaper notices are distinguished from actual financial results or transcripts. Sources, earlier excerpts, alert lifecycle rows and visitor preferences are retained. Document-type corrections use existing revision triggers to invalidate affected research caches.

A one-time definition review v4 retains earlier Gemini Revenue/Operating margin/Borrowings rows as unverified, with an audit record, when their own accepted excerpt does not establish that accounting label. Total income is not revenue, EBITDA margin is not operating margin, and gross debt is not automatically borrowings. No source/history record is deleted.

The migration journal and Drizzle snapshots are tracked. Do not modify already applied SQL. No financial records, watchlists or preferences are reset by migration.

## Backup and recovery

Stop the local server before migration or recovery. Run `npm run db:backup`; it uses SQLite VACUUM INTO to produce a consistent standalone snapshot in ignored `.sites-runtime/backups/`. Keep that file before applying migrations. It contains personal visitor selections, so do not commit it.

Use `npm run db:migrate:local` for empty or journaled databases. Some older checkouts applied the initial SQL without a migration ledger. After backing up, `node scripts/adopt-local-baseline.mjs` verifies every original table column before registering the initial migration. A mismatch aborts adoption. Then apply migrations normally.

For recovery, keep the server stopped. Preserve the current database and its sidecars separately, restore the chosen snapshot into the same local D1 filename, and restart. Reapply only migrations that were not recorded in that snapshot. Never copy a live SQLite file without a consistency-aware backup. No hosted migration or restore was performed in this upgrade.

## Data model

| Records | Relationships and rules |
| --- | --- |
| owners, portfolio_companies, alert_preferences | Stable anonymous owner; unique owner/ticker; owner deletion cascades personal state; company deletion restricted |
| companies, documents, document_chunks | Shared public data; composite document/company identity prevents cross-company chunks; PDF hash unique; chunk page positive; FTS insert/update/delete triggers |
| announcements | Source-linked normalized headline/category/date/score/method/mode, original payload, unique content identity; filters use structured columns |
| daily_prices | Unique ticker/date/mode; positive closes, nonnegative volume; replay and current series coexist |
| financial_metrics | Unit, basis, fiscal period, source page, evidence, extraction/verification method; valid company/document/page required; reviewed and source-checked facts kept distinct from unverified extraction history |
| metric_derivations | Deterministic value, formula and both input metric foreign keys |
| guidance_statements, guidance_comparisons | Original page quote, target/range, unit/basis/period/revision link; comparison references actual financial metric; incompatible or missing actuals refuse scoring |
| alerts | Owner and event identity, observed time, mode, priority, source, state/read/dismiss timestamps; idempotent without lifecycle replacement |
| ingestion_runs, source_sync | Attempt/success/failure, counts, errors, last success, cooldown and retry; failed checks never imply absence of filings |
| analysis_cache, ai_operations | Expiring source/model/prompt-versioned results; provider status, safe error codes, duration and reported token usage |
| request_budgets, job_locks | Atomic persisted global/session cost limits and expiring concurrency controls |

FTS5 is compatible with local SQLite/D1 and tested. A bounded lexical fallback remains available. Existing facts are not destroyed when a conservative parser no longer accepts an extraction; it marks those rows unverified and excludes them from research/calculation inputs.

Event payloads may retain `canonical_event_id` for historical aliases; their records and alert references remain intact and direct IDs remain available. Normal feeds and future alert evaluation use canonical records. Explicit event quotes distinguish same-category events on a shared page; categories distinguish results/dividend/management events in one document.

Backups were taken before both reliability migrations. A copy of the latest populated pre-upgrade database preserved all counts across companies, documents/chunks, metrics, owners, portfolios, settings, announcements, alerts, guidance and caches while applying 0004/0005, with zero foreign-key violations. Empty and original seeded/custom-owner databases also ran the full migration sequence.

## Final corrections verification

Backups preceded 0006/0007. Applying both to a copy of the populated pre-0006 database preserved counts across all 31 existing tables (including 194 owners, 30 documents and 137 financial metric history rows), with `integrity_check=ok` and zero FK violations. A `VACUUM INTO` snapshot reopened successfully. Empty-database and original seeded/custom-owner migration tests also pass. An actual localhost restart preserves watchlists, settings, dismissed alerts, documents/chunks, metrics, guidance, sync ledgers, queued document work and successful research caches. Test databases and snapshots are ignored; none replace the working database.
