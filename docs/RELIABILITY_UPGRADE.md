# FINN reliability upgrade — 2 November 2026

Existing project edited in place on `upgrade/sqlite-gemini-push-pull`, starting at 9378c42. No ZIP was opened, no application was duplicated, no environment file was overwritten, and no code, database migration or deployment was sent to production.

## Preserved

The React/Vinext/Worker stack, SQLite/D1 and Drizzle, native Gemini SDK, existing appearance and mobile navigation, original 18-company starter portfolio, historical market observations, original source PDFs, reviewed financial facts, anonymous HttpOnly visitor sessions, preferences, original event IDs, evidence viewer, guidance tracker and notification lifecycle remain. The existing request-body drain fix, owner isolation, adjusted-close calculations, prior-session volume baseline, source URL controls, and financial provenance checks were retained.

## Fixes and additions

| Area | Final behaviour |
|---|---|
| Financial periods | Cash-flow wording uses the selected records' year. Calculated FCF subtracts capex outflow magnitude only with matching period, company, basis, currency and units. Reported FCF stays distinct from calculated FCF. |
| Quarterly comparisons | Most recent verified quarter, prior quarter and prior-year quarter remain deterministic. Zero/negative bases, incompatible dimensions, unverified records and conflicting duplicate facts refuse comparison. Explicit restatements take precedence; extraction timestamps alone do not establish restatements. |
| Event identity | Document hash, optional exchange filing ID and source-evidence event signature are separate. Category and exact source scope distinguish events on the same page. `event_quote` supports separately scoped same-category events. Headline wording is excluded from the signature. Legacy records reconcile without changing IDs. Historical aliases retain their source and alert rows; canonical feeds avoid resurface duplicates. |
| Materiality | Explicit amounts, percentages, actions, executive roles, effective dates, capacity and rating labels feed deterministic scores. Unknown financial magnitude receives a neutral weight. Absolute amount bands are explained without unsupported company-relative or price-impact claims. |
| Announcement discovery | A reusable dated official-HTML-table adapter is registered for NTPC. Other companies use permitted original-PDF link discovery with an explicit verified-manual-import fallback. Undated directory links do not become invented announcements. First official sync samples two latest accessible filings and states its incomplete historical coverage. |
| Jobs | Protected `sync-announcements` and unified `sync` connect source discovery/import, market updates and saved-owner alert evaluation. Each request handles at most three companies, two filings/company and 30 owners, with company/owner continuation cursors. Independent source failures, attempts, successful empty checks, counts, cooldowns and source cursors persist. No cloud schedule has been activated. |
| Document discovery | Up to 80 permitted candidates are collected and ranked by question/type/period; four new documents are processed per interactive refresh. Pending/unavailable candidates, available sizes and index progress persist. Existing libraries can refresh, with a 24-hour automatic attempt interval. Explicit historical periods already indexed avoid unnecessary discovery; the source-refresh button remains available. |
| Large/local files | The protected administrative local-file workflow hashes actual PDF bytes, extracts locally and uploads bounded idempotent chunk batches. Interrupted sources remain indexing; scanned/blank text coverage is partial. Limits remain explicit: interactive default 8 MB/500 pages, configurable within caps; local-file safeguard 32 MB/1,000 pages. |
| Retrieval | FTS joins return complete matching chunk records directly. Hits beyond chunk 2,500 are reachable. SQL company/type/period filters and financial synonyms precede bounded lexical reranking. Forward guidance can match its target year while preserving the earlier source document's actual reporting period. |
| Extraction | Conservative prose plus explicit delimited-table extraction retain row labels, headings, units, basis, audited/restated labels and page evidence. Gemini passage selection varies by document type. Ambiguous tables and rejected/superseded extractions are audited. Operating profit alone is rejected as EBITDA; earlier such Gemini rows remain stored but unverified. |
| Gemini | Native `@google/genai` remains. Fast classification/extraction and optional reasoning-model research routing use the existing model settings. Prompt version `finn-evidence-v4`, literal quotes, source/company IDs, numbers, periods, directional claims and proposed/completed qualifiers are checked. Failures, timeouts and request-budget exhaustion retain safe explicit codes and useful deterministic/source fallback. |
| Cache | Company-specific database revision triggers cover documents/chunks, metrics, guidance/revisions and calculation inputs. The key also includes model configuration, prompt/retrieval versions, question and filters. No-op seed annotations and unchanged derivations no longer invalidate answers after restart or ordinary briefing views. Expired task-cache rows are pruned in bounded batches. |
| Announcement API | Stable date+ID cursor pagination supports company, category, date window, priority and mode. Details query the primary key directly. Original IDs remain accessible beyond the feed page limit. Portfolio/digest reads now scope and batch database work before rendering. |
| Company search | Cached names, punctuation-tolerant names, symbols, public Yahoo lookup and NSE's official equity CSV directory are supported. Verified results expose exchange, portfolio membership and indexed-document count. Unknown/unavailable directories return limitations rather than guessed symbols. |
| Guidance | Verified statement/actual selection requires exact compatible definitions. Revisions require matching units; superseded and approximate guidance have explicit states. The existing card now shows statement date → target year, actual, variance and both source links. |
| Database | Incremental migrations 0004 and 0005 add event identities, company revisions, discovery progress, extraction audit, restatement metadata, indexes and comparison-integrity triggers. Earlier migrations are unchanged. No source records, portfolios, settings or notifications were reset. |

## Changed files

- Financial/domain: `lib/domain.ts`, `lib/periods.ts`, `lib/research-analysis.ts`, `lib/financial-extraction.ts`, `lib/types.ts`; new `lib/event-analysis.ts`, `lib/query-plans.ts`.
- Backend/AI: `lib/server.ts`, `lib/workflows.ts`, `lib/ai/gemini.ts`, `lib/ai/provider.ts`, `lib/ai/service.ts`, `app/api/[...path]/route.ts`.
- Discovery/import/search: new `lib/ingestion/announcements.ts`, `lib/ingestion/discovery.ts`, `lib/ingestion/local-file.ts`, `lib/company-search.ts`, `lib/company-directory.ts`, `data/announcement-sources.json`.
- Database: `db/schema.ts`, migrations `0004_flimsy_deathbird.sql`, `0005_parallel_outlaw_kid.sql`, their Drizzle snapshots and journal.
- Existing UI: `components/Evidence.tsx`, `Portfolio.tsx`, `PromiseTracker.tsx`, `Research.tsx`, `SystemStatus.tsx`. Navigation, layout and visual identity are preserved.
- Jobs/config: `scripts/run-local-job.mjs`, new `scripts/import-local-pdf.mjs`, `scripts/validate-retrieved.py`, `package.json`, `.env.example`. Existing `.dev.vars` remains untouched and ignored.
- Verification: existing API/database/native-Gemini tests; new `tests/reliability.test.ts`, `tests/reliability-api.test.mjs`, `tests/cache.integration.test.mjs`; source-backed examples in `docs/examples/infy-dividend.json` and `ntpc-*.json`; actual mobile screenshot.
- Documentation: README, architecture, database, AI pipeline, demo, limitations, checklist and verification report.

## Actual end-to-end results

PUSH: NTPC's original public disclosure table yielded 80 dated primary PDF links. Its bounded initial sync imported two latest filings, persisted the cursor, classified source evidence, ranked capex events, stored SQLite records, surfaced them in the owner-filtered live briefing and generated in-app notifications. A subsequent successful check inserted zero events, with a successful check timestamp rather than a failure. Manual imports also demonstrated an authentic acquisition, affirmed credit rating and routine publication. Infosys results and dividend from the same PDF page persist separately, reimport under alternate headlines without duplicates, and generate independent alerts.

PULL: previously uncached Britannia resolved by company name through NSE's official directory. Four original BSE transcripts were indexed; Q1 FY2027 came from the source header. Real app-level Gemini synthesis reported the source's 9.5% sales and 12.7% / 13.7% / 13.6% operating-profit / PBT / PAT growth with a valid PDF-page citation. Its separate risk response retained uncertainty. An independent audit checked Q4 FY2026 revenue/PBT/PAT and annual PBT/PAT against original transcript page 7; unsupported EBITDA stayed unavailable. Real app-level HCL FY2026 guidance synthesis also succeeded.

The actual model was `gemini-3.5-flash-lite`. Native provider tests, actual research responses, validated cache invalidation, and honest rejected/budget-limited responses were observed; configuration alone is not reported as successful synthesis. See [actual test results](VERIFICATION.md).

## Readiness and limits

Ready for local review and the separately authorized deployment phase after final acceptance. Production is unchanged. Target D1 migrations, secret configuration, hosting quotas, scheduler choice and production smoke tests must be completed during that authorized phase. Public-source access, arbitrary PDF/OCR layouts, source completeness and provider quotas remain explicit limitations, detailed in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). No exchange-wide monitoring or universal financial-PDF extraction is claimed.
