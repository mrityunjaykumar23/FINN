# FINN. Institutional Intelligence — local review report

Verified 3 November 2026 (Asia/Kolkata). Branch: `redesign/institutional-intelligence`.

**The redesigned application is running at http://127.0.0.1:5173/ using its production build and existing persistent local SQLite/D1 database. Nothing from this redesign has been deployed or pushed. It is ready for local visual and functional review; production sign-off is held by intermittent Gemini failures and an incomplete cold financial PULL acceptance test.**

## 1. Visual redesign

Implemented Option A, Institutional Intelligence, in the existing React/Worker application. The navy workspace, teal navigation, compact sans-serif headings, restrained cards, consistent inputs and semantic financial colors replace the previous olive theme. Desktop uses a 228px navigation rail and compact header; tablet/mobile uses the FINN. header and bottom navigation, including at 1024px where the former layout collided. Existing anonymous sessions, portfolio membership, routes, evidence, financial calculations and source data remain in place.

The briefing prioritizes developments, anomalies and coverage separately. Research has a branded question composer, real suggested questions, durable progress, financial snapshots and structured reports. Guidance comparisons now show truthful range/actual positions and neutral missing-evidence states. Portfolio values distinguish unavailable data from zero. Alerts keep their source diagnostics in an expandable disclosure. Evidence dialogs retain original excerpts, source links, units, periods and comparable financial tables.

## 2. Branding assets

- `components/Brand.tsx`: original geometric signal/F mark, FINN. wordmark and research avatar.
- `public/favicon.svg`: custom navy/teal favicon.
- `public/finn-icon.svg` and `public/finn-wordmark.svg`: reusable SVG brand exports.
- Primary descriptor: **Financial Investment Agent**. Tagline: **Signal over noise.** Research identity: **FINN Research.**
- `public/fonts/`: self-hosted Geist and Geist Mono Latin WOFF2 files, with their OFL licenses. No font service is required at runtime. Geist licensing references: [Vercel Geist](https://github.com/vercel/geist-font), [Google Fonts OFL](https://github.com/google/fonts/blob/main/ofl/geist/OFL.txt).

## 3. Palette and typography

| Token | Final value |
| --- | --- |
| Main background | `#080F1D` |
| Secondary background | `#0B1626` |
| Surface | `#101E30` |
| Card | `#132238` |
| Hover | `#182B43` |
| Primary text | `#F0F6FA` |
| Secondary text | `#A4B3C4` |
| Muted text | `#8496AC` |
| Teal accent | `#55DCC4` |
| Evidence/link blue | `#5A9CE5` |
| Positive | `#38C9A0` |
| Warning | `#E7AF62` |
| Negative | `#EF777D` |

UI typography uses Geist, with Geist Mono/tabular figures for financial and operational values. The requested muted shade `#74879D` was raised to `#8496AC`: calculated contrast on the card surface improves from about 4.34:1 to 5.28:1. Body copy, metadata, controls, charts, surfaces, focus states and reduced-motion behavior use shared styling. Status wording accompanies color. This is practical accessibility QA, not a formal WCAG conformance certification.

## 4. Screens verified

Briefing, Research, Portfolio, Promise Tracker, Alerts, structured research output and the native evidence dialog were checked at **320, 375, 390, 430, 768, 1024 and 1440px**. All **49 viewport checks** passed without horizontal page overflow; the evidence dialog also remained contained. Financial tables may scroll inside their own bounded containers.

Browser-driven checks covered mobile navigation, opening/closing evidence, company search, adding DMART, refresh persistence, removing the test addition, saving/restoring alert rules, and opening both original Infosys guidance/result sources. The existing 18-company browser watchlist was restored. A separate process-restart test verified a test visitor's 19-company portfolio, saved threshold, unchanged alert history and queued research request, plus isolation from another visitor; it restored its test watchlist afterward.

## 5. Source files changed

| Area | Files |
| --- | --- |
| Theme/layout | `app/globals.css`, `app/institutional.css`, `app/layout.tsx` |
| Brand/common | `components/Brand.tsx`, `components/common.tsx` |
| Product screens | `components/Dashboard.tsx`, `Briefing.tsx`, `Research.tsx`, `ResearchReport.tsx`, `PromiseTracker.tsx`, `Portfolio.tsx`, `AlertSettings.tsx`, `Evidence.tsx` |
| Display semantics | `lib/presentation.ts`, `lib/types.ts`, `lib/domain.ts` |
| Research/API | `app/api/[...path]/route.ts`, `lib/server.ts`, `lib/research-jobs.ts`, `lib/research-filters.ts`, `lib/ai/gemini.ts` |
| Source/event reliability | `lib/ingestion/adapters.ts`, `discovery.ts`, `document-jobs.ts`, `lib/event-evidence.ts`, `event-analysis.ts`, `query-plans.ts`, `workflows.ts`, `data/announcement-sources.json` |
| Database | `db/schema.ts`, migration `0009_brave_the_stranger.sql`, its snapshot and migration journal |
| Verification | `tests/corrections.test.ts`, `database.test.mjs`, `deployment.test.ts`, `upgrade-api.test.mjs`, `research-jobs.integration.test.mjs`, `package.json`, `scripts/run-local-job.mjs`, `verify-async-research.mjs`, `verify-local-push.mjs`, `verify-local-persistence.mjs` |
| Assets/docs | The SVG/font assets above, `README.md`, `docs/DATABASE_DESIGN.md`, `docs/KNOWN_LIMITATIONS.md`, this report, screenshots and `docs/test-results/` |

No FastAPI/PostgreSQL migration, new project directory or replacement frontend architecture was introduced. Existing hosting identities and environment configuration were preserved.

## 6. Backend corrections and retained fixes

**Publication precision:** verified and fixed the remaining Maruti date-only adapter bug. Only a valid full timestamp with a timezone establishes recorded datetime precision. Calendar-only values retain their date, a null raw timestamp and an explicit date-only label. Precise display converts the date and time together to IST, including midnight rollover.

**Financial jobs:** retained the working extraction-outcome safeguards. Indexing and financial extraction now also run as separate bounded research phases. Indexed files are reused for financial retries; an indexed PDF is not presented as successful financial extraction. Failures remain `extraction_failed`, and unsupported/empty accepted financial output requires review. The source library displays indexing and financial states separately. The live Polycab failure verified this behavior rather than being marked complete.

**Independent candidates:** verified the existing per-candidate failure isolation and retained it, including failure/attempt/retry records. One failed candidate does not terminate its independent neighbors. Regression tests cover this behavior.

**Alert settings:** retained settings-only persistence; saving rules does not evaluate/recreate historical alerts. Repeated-threshold regression, browser save/refresh and process-restart tests passed. Explicit evaluation preserves dismissed notifications.

**Source coverage:** added the official ITC dated-disclosure adapter, alongside NTPC, SBI and Maruti. Discovery found 135 dated ITC originals and retained a bounded backlog. Two PDFs initially yielded four automatic records; review identified two unsupported secondary classifications. The cash-flow dividend reference and transaction reference inside financial notes are retained with `review_required`, an audit entry and original evidence, and excluded from active briefings/alerts. Two supported ITC records remain active. This does not establish full NSE/BSE or all-portfolio monitoring.

**Event evidence:** dividend matching now requires declaration/recommendation/approval language instead of matching cash-flow references or currency-like substrings. Automatically inferred transactions embedded in financial notes require an appropriate transaction title. A legacy stitched NTPC excerpt was expanded to its original contiguous passage only after verifying each ordered literal fragment on that same page. Its prior excerpt is retained in the extraction audit; event IDs and alert foreign keys remain intact.

**Document selection:** call/meeting invitations, recording notices and newspaper-publication disclosures no longer masquerade as actual results or transcripts. Explicit document-type requests only queue matching candidates. Existing affected metadata is corrected idempotently with document audit records and normal company-version cache invalidation. The original PDFs and extraction history remain available. Scanned newspaper pages still require OCR/manual work.

**Research responsiveness:** added visitor-owned durable requests with discovery, indexing, extraction and synthesis status. Creation returns without waiting for a PDF/model response. Atomic claims, leases, bounded retries and owner checks allow resumption without duplicate downloads. Successful matching answers are reused; degraded responses can be retried and are not permanent success caches. Canonical filter ordering fixes cache identity differences between the existing synchronous route and the durable route. Old routes remain supported.

Each model operation has a shared 24-second deadline including retries, with a maximum 23-second individual request. This accommodates the existing Worker phase rather than stacking three 25-second calls. Native `@google/genai` remains in use; no key/model was changed. The existing runtime's [`waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/) is used. The browser advances phases; closing it pauses advancement between phases until resubmission. No separate queue infrastructure or unsupported unattended research guarantee was added.

## 7. Database and environment

Migration **0009** creates only `research_jobs` and its owner/time index, with foreign keys to existing owners, companies and optional document jobs. A pre-migration snapshot was retained. Applying the migration to a backup preserved all **32 pre-existing table counts** exactly. Fresh migration/demo checks also passed.

The final backup returned **`integrity_check=ok` and zero foreign-key violations**. It holds 30 company records, 48 documents, 3,577 chunks, 144 financial metric records and 26 announcement records, including the two review-retained events. These are local development/test data counts, not a claim of complete verified exchange coverage or real users. No database was reset. Idempotent metadata/evidence corrections are audited separately from the additive schema migration.

`.dev.vars` remains ignored and uncommitted. No existing API key was overwritten or exposed. Production encrypted secrets and hosting/schedule configuration were not changed in this local-only task.

## 8. Gemini and complete workflow results

**PUSH passed:** authentic ITC Sproutlife amalgamation disclosure (2 November), SBI original disclosure (29 October) and NTPC commercial-operation disclosure (30 October) were traced through stored source page, classification, materiality, briefing and owner alert. Exact excerpts matched their indexed originals. Dismissal survived re-evaluation. See `test-results/redesign-push.json` for original URLs/pages, IDs and scores.

**Gemini is configured and genuine successful responses were observed**, including the final real HTTP cache-invalidation test and the latest direct research/guidance tests. Authenticated native SDK model listing also established access to the configured model earlier in the work. Configuration alone is not treated as successful execution.

The **latest direct credentialed run passed 2/3 tests**: grounded Infosys research and HCL guidance passed; risk analysis failed with `provider_failed`. An earlier final-build attempt passed 1/3. These are executed failures, not skipped tests. No failure was relabelled as Gemini success.

**Cold financial PULL is not fully signed off.** POLYCAB.NS was verified to have zero indexed documents/metrics, then discovered and indexed an authentic BSE transcript. Job creation took 79ms after ticker validation, and text was available in about 3.5 seconds. Financial extraction and synthesis timed out; the initial request finished as an explicitly labelled fallback in about 40.9 seconds. The due financial retry also timed out, leaving the document job failed and retryable rather than complete. No accepted numeric records were invented. Earlier notice-selection tests for other companies exposed and motivated the document-type fixes above; those partial runs are not counted as complete financial acceptance passes.

The redesigned browser research report was tested with Electrosteel outside the original portfolio. Its stored original transcript, Rs.48.4 crore PAT decimal, source links and deterministic findings display correctly. The latest fresh synthesis timed out and the visible report honestly showed its Gemini-unavailable state. It is not claimed as a successful live Gemini PULL acceptance.

## 9. Final executed tests

| Suite/check | Result |
| --- | --- |
| Unit/domain/database/research/AI/period/extraction/reliability/corrections/deployment tests | **81 passed** |
| Existing API + upgrade API | **17 passed** |
| Reliability API | **4 passed** |
| Concurrent authentic ingestion | **1 passed** |
| Durable research ownership/deduplication/status | **1 passed** |
| Real Gemini HTTP cache invalidation, isolated DB | **1 passed** |
| Fresh migrated authentic demo/idempotence, isolated DB | **1 passed** |
| Latest direct real Gemini tests | **2 passed, 1 provider failure** |
| TypeScript | **Passed** |
| ESLint | **Passed, no warnings** |
| Production build | **Passed** |
| Independent Python financial scripts | **All 3 passed** |
| Process restart + visitor isolation | **Passed** |
| Responsive containment | **49/49 passed** |
| Authentic stored PUSH acceptance | **Passed** |
| Cold financial PULL acceptance | **Not passed: provider timeouts** |

The named automated suites total **109 tests: 108 passed, 1 failed, 0 skipped**. The separate cold-workflow failure is additional and must not be hidden by that aggregate. The Python checks independently verified 18 market summaries, eight quarterly comparisons, nine DMART values/six percentage calculations, and five Britannia values; unsupported PBT/EBITDA substitutions stayed unavailable. Production build output contains the existing vinext dynamic-route-classification informational notice, not a build failure.

Machine-readable totals, exact logs, database integrity/migration evidence and browser/persistence checks are in `docs/test-results/`. Local operational backups and private runtime files remain ignored under `.sites-runtime/`.

## 10. Before/after screenshots

- Baseline: `docs/screenshots/redesign/before/` — desktop/mobile briefing and mobile research, portfolio, promises and alerts.
- Final views: `docs/screenshots/redesign/after/{briefing,research,portfolio,promises,alerts,evidence}-{320,375,390,430,768,1024,1440}.png`.
- Additional views: `promises-sources-desktop.png` and `research-report-desktop.png`. The research report screenshot includes the honest provider-fallback state.
- Responsive results: `docs/test-results/redesign-responsive.json`; mobile interactions: `redesign-mobile-flows.json`; process restart: `redesign-restart.json`.

## 11. Remaining limitations

1. Intermittent real Gemini generation/extraction failures remain reproducible. Risk analysis and complete cold financial PULL need a clean acceptance run before production approval. Do not remove evidence checks or silently switch models to obtain a superficial pass.
2. Automatic announcement registration covers four companies, not every supported/searchable NSE company. Backlogs, Maruti source access failures and missing authoritative dates remain explicit.
3. Discovery is a bounded directory of original-file links, not an exchange-wide feed. Some document types/periods are unavailable. Scanned and very large PDFs may require manual original-file processing/OCR.
4. Citation/excerpt/number checks establish linkage and reject many unsupported outputs; they do not prove every semantic inference or completeness of a filing.
5. Research phases resume while the browser advances them or when the same request is submitted again. There is no new autonomous parent-research queue.
6. The earlier host task retained a single next run instead of its requested recurrence. This task did not alter that configuration; continuous unattended scheduling is still unverified. The existing 2026 market calendar needs maintenance for later years.
7. Alerts are in-app. Phone/browser push delivery and full account identity are outside this prototype. Browser QA used Chromium viewport emulation; physical mobile/Safari testing remains advisable.

## 12. Local readiness and deployment decision

**Ready for the user's localhost review. Not approved for production replacement.** The production build, existing database, brand assets, core regressions, source-backed PUSH and safe demo setup are ready. Resolve or explicitly accept the reproducible Gemini/cold-PULL limitations and verify the hosted updater's recurrence before production sign-off. Any later staging/production publication requires the user's authorization and new live-endpoint checks. The previously published public FINN and private staging deployment remain unchanged by this redesign.
