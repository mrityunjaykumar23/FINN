# Actual upgrade work record

31 October–1 November 2026. This is a factual activity summary, not a fabricated full conversation export. The earlier genuine conversation/activity files remain intact. The supplied upgrade request is preserved in `UPGRADE_REQUEST.md`.

The user requested work inside the existing FINN codebase, localhost testing, a separate branch/local commits, and no GitHub push until complete review. The user also said “I’ll configure .dev.vars”; a local key became available during implementation. Its value was never included in prompts, logs, source files or this record.

- Inspected the existing domain/server/research/UI/database/ingestion modules, both migration metadata and existing tests. Created `IMPLEMENTATION_AUDIT.md`, then implemented changes rather than stopping at the audit.
- Created `upgrade/sqlite-gemini-push-pull` from the published baseline. Backed up local SQLite with VACUUM INTO. Verified and adopted the unjournaled original schema before applying new incremental migrations.
- Installed official `@google/genai` 2.32.0. Checked Google primary SDK/model/structured-output/pricing documentation. Integrated provider tasks, Zod validation, evidence checks, bounded retries/budgets/concurrency, extraction and research caches and telemetry.
- Hardened anonymous ownership, concurrent first-use setup, relational/source-page integrity, queryable records, guidance and notification lifecycle. Preserved shared evidence and historical replay.
- Imported authentic NSE DMART Q3 results and management transition, plus official HCLTech original/revised guidance disclosures. Tested duplicate detection, Gemini extraction/classification and matching actuals. Fixed an annual/quarter/nine-month extraction ambiguity before accepting corresponding facts.
- Initial LTTS source discovery failed on redirects/size. Added bounded, allowlisted ordinary redirects; two BSE PDFs then indexed successfully, with the oversized report still excluded. Real Gemini research returned source-linked findings for this previously unseen ticker.
- Some Gemini summaries failed grounding checks and correctly fell back. Improved prompt scope and permitted summary substitution only from an independently accepted model finding. A real credentialed Infosys test and complete HTTP synthesis then passed.
- Ran 39 unit/database tests, 15 localhost HTTP tests, real Gemini integration, concurrent authentic-ingestion integration, TypeScript, production build, original/dynamic independent Python financial audits and a true server restart durability probe. Fixed stale tests that had assumed company guidance coverage could never grow.
- Used the browser to check mobile navigation, portfolio persistence, notifications, evidence tables, actual Gemini status/quotes and desktop layout. Restored temporary changes to the browser portfolio and read state. Saved QA screenshots.
- Verified a genuinely empty SQLite database through the built Worker. Fixed fresh seed metadata, root secret loading for `npm start`, and an unread POST-body issue exposed only by the built preview; both development and built-Worker HTTP suites passed afterward.
- No GitHub push, hosted database migration, production deployment or external message was sent during the upgrade.
