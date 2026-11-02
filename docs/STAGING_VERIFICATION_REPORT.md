# FINN staging verification — 2 November 2026

## Publication and approval boundary

Staging: https://finn-enam-staging-mrity.hazyanole2049.chatgpt.site (owner-private; sign in with its owner's ChatGPT account).

The initial live acceptance passed on source `17a56348196890f5ca0967ccdee724e4d85bbee9`, staging Site version 2, encrypted environment revision 2. A final staging publication includes the visual QA record and corrects stale alert-settings scheduler wording. The source helper commits and pushes this branch to the staging Site's own repository; it does not push to GitHub. Exact source provenance is also retained by the native saved Site version.

The original public FINN Site remains at version 2 at https://finn-investment-intelligence-mrity.hazyanole2049.chatgpt.site. Its database, access policy, environment and schedules were not changed. Its hosting identity is retained in `.openai/production-hosting.json`. Replacing that deployment requires the user's approval. Staging is a separate hosted Site, not an in-place preview channel on production.

## Corrections made in the existing application

| Finding | Verified implementation |
| --- | --- |
| Date-only precision | `lib/pipeline-state.ts` normalizes actual company timestamps separately from calendar dates. `lib/workflows.ts` and admin imports persist truthful precision and labels; initialization safely repairs earlier metadata. No date-only value becomes an exchange clock time. |
| Financial extraction failure marked complete | `lib/ingestion/document-jobs.ts` and the interactive path in `lib/server.ts` separate indexing from extraction, persist the indexed document before extraction, retain extraction errors/results, retry without redownloading, and require manual review after exhausted or unsupported financial extraction. |
| One announcement failure interrupts other candidates | `lib/ingestion/announcements.ts` uses per-candidate failure isolation and durable retry state. Live staging verified Maruti PDF failures while NTPC and SBI continued. |
| Settings regenerate historical alerts | `app/api/[...path]/route.ts` saves preferences without implicit replay/evaluation. Existing lifecycle states survive. Explicit briefing/evaluation actions remain supported. |
| Independent financial validation regression | `lib/financial-labels.ts` conservatively includes the original adjacent revenue heading where a short stored quote omitted it. The source-context reconciliation preserves the old excerpt in the audit. Britannia revenue is restored from its source; operating profit is not relabelled EBITDA. |
| Unattended updates | `lib/scheduled-jobs.ts` and `/api/jobs/scheduled` provide authenticated, bounded market/discovery/ingestion/evaluation/document phases with continuation cursors and verified exchange-calendar checks. |

Frontend design, original routes, per-visitor portfolios, guidance comparisons, Worker hosting, SQLite/D1 and native Gemini SDK are preserved. `components/AlertSettings.tsx` only updates the scheduler explanation.

## Automated verification

All **100 automated tests passed**, with no skipped acceptance tests:

| Suite | Passed |
| --- | ---: |
| Unit/database/financial rules, including new deployment regressions | 73 |
| API integration, including settings-save and job authorization regressions | 17 |
| Reliability API | 4 |
| Announcement ingestion | 1 |
| Real Gemini integration: grounded research, guidance and risks | 3 |
| Cache integration against an isolated production preview | 1 |
| Fresh database demo preparation and idempotency | 1 |

Type check and lint passed with zero errors or warnings. Production Worker builds and both native staging publications succeeded. The original independent financial validation scripts passed: 18 market summaries plus eight quarter facts; nine DMart values plus six percentage calculations; five Britannia facts with unsupported EBITDA excluded.

Local evidence is in ignored `.sites-runtime/staging-*.log`, `.sites-runtime/staging-migration-check.json` and `.sites-runtime/staging/*.json`. Operator tooling is `scripts/verify-preview.mjs`; its secrets enter hidden stdin and stay in memory.

## Database and secrets

Migration `0008_orange_winter_soldier.sql` adds only nullable `document_jobs.extraction_status` and `extraction_result` text columns. Migrations 0000–0007 remain unchanged. The migration was checked against a backup: all 32 pre-existing tables retained row counts, SQLite integrity was `ok`, and foreign-key violations were zero. All nine migrations also succeeded on a fresh test database. Native hosted D1 inspection confirmed the schema and actual stored documents, metrics and announcements. No original local or public-production database was reset or replaced.

Staging demo preparation ran twice with unchanged second-run counts: 17 primary documents, 634 chunks, 12 announcements, 76 financial metrics and four guidance statements. A new visitor retains the original 18-company starter portfolio. Subsequent authentic PUSH/PULL tests expanded the database to 20 documents, 673 chunks, 14 announcements and 81 metrics. Later scheduled ingestion/document processing adds further authentic data; these figures identify the acceptance-test checkpoint, not a fixed ceiling.

The prepared seed persisted through the version-1 to version-2 deployment. Subsequent live requests verified portfolio edits, alert preferences, dismissed alerts, cached research and stored document/metric counts. Native D1 reads independently confirmed persistent storage.

`GEMINI_API_KEY`, model settings, `ADMIN_TOKEN` and `SITES_SCHEDULED_TOKEN` are encrypted server environment entries (all `is_secret: true`). `.dev.vars` was preserved, remains ignored and is absent from the source/deployment archive. No local SQLite database was uploaded. The platform service-access header alone does not authorize scheduled writes; the application additionally validates its job-specific header. Unauthorized writers return 403.

## Authentic live PUSH

The deployed app discovered nine entries from SBI's [original October–December 2026 disclosure table](https://sbi.bank.in/web/corporate-governance/3rd-quarter-2026-27), imported two, indexed the original PDF, classified/scored the event, stored it in hosted D1, presented it in briefing with exact evidence, created an owner alert under an explicit minimum-priority-zero test preference, and persisted dismissal. This routine filing was truthfully `unclassified`; the test does not imply it met the default materiality threshold.

Acceptance filing: `87d6964cc60f21401e1baef7`, source-table publication date **29 October 2026**, original [SBI PDF](https://sbi.bank.in/documents/17826/17948/491_02112026.pdf/19dd4e2d-d87e-f38c-00f7-bf60319d5739?t=1793604056354), evidence page 1. The table date is retained despite the later date in the URL filename. No artificial publication time is asserted.

## Authentic live PULL and Gemini

The deployed app researched **Electrosteel Castings (`ELECTCAST.NS`)**, outside the original demo portfolio and bundled examples, using its original Q1 FY2027 transcript hosted by BSE. Native Gemini returned `ai_status: success`, model **gemini-3.5-flash-lite**, with 6,013 input and 1,018 output tokens. This was actual provider execution, not an extractive fallback.

The answer states consolidated total income ₹1,465 crore, EBITDA ₹139 crore and PAT ₹48.4 crore. Five source-checked structured metrics preserve total income separately from revenue and gross debt separately from net debt. Eight citations resolve to the original BSE PDF with pages and exact supporting excerpts; for example [page 4](https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=f8efa6f6-7dc6-4d8a-ba9d-fdfe04f00e74.pdf#page=4). Wrong-company/page/quote and unsupported metric checks passed. Repeating the same research returned the cached result.

Two independent visitors retained separate portfolios and settings. Adding Electrosteel and removing TCS for one did not modify the other. Saving alert preferences did not regenerate historical alerts.

## Scheduled updates

The linked cloud schedule **Refresh FINN staging intelligence** is enabled and was read back from the staging Site: daily **09:30, 13:30, 18:30 and 20:30 Asia/Kolkata**. Discovery, bounded ingestion, owner alert evaluation and one queued document step run each time. The 20:30 run additionally refreshes completed NSE market sessions. Daily announcement checks cover weekend disclosures; exchange-calendar guards still govern prices.

The exact intended service-access/application-authorization path was executed manually on the deployed Site: ten bounded requests refreshed all 19 distinct monitored symbols through the completed 2 November session, discovered registered sources, ingested two additional SBI filings, and evaluated both stored test visitors. Maruti's two PDF failures remained `partial`; NTPC and SBI continued. A further document-job step successfully indexed an original and accepted ten financial rows while rejecting two unsupported candidates. Its completion followed successful extraction. Final readback held 23 documents, 708 chunks, 16 announcements, 91 metrics and four guidance statements.

Schedule creation and readback verify saved/enabled timing. **A future cloud-triggered execution has not yet been observed**; no such completion is claimed. First-run monitoring and review of source/provider errors remain necessary. The existing public production Site has no schedule added by this work.

## Visual acceptance

The deployed HTML, JavaScript, assets and API responses were tested through a temporary loopback-only service-authenticated relay to the exact private staging origin. It forwards to hosted D1/Gemini; it does not serve a local application build or local database. Credentials stay in server memory and admin/job writes are blocked through the relay. The relay is a disposable ignored QA harness, not part of the application architecture. It will be stopped after verification.

At 1440 × 1000, the live seven-day briefing displayed the two actual NTPC announcements, source coverage and EOD anomalies without horizontal overflow. At 375 × 812, the evidence dialog retained the exact original excerpt, primary PDF link and corrected date-only precision label without horizontal overflow. Mobile portfolio search/add completed against hosted D1; the added Electrosteel company survived reload, and removal restored the original 18 entries. Research independently selected Electrosteel outside that portfolio, returned a successful native Gemini answer, and displayed the BSE page-4 citation and the ₹48.4 crore PAT decimal. Its result also had no horizontal overflow. The promise tracker loaded all four source-linked comparisons and expanded the original Infosys guidance excerpt. Alert rules loaded hosted source status and persisted changes without regenerating the displayed 18 unread notifications.

Screenshots: `screenshots/staging/desktop-briefing.png`, `mobile-evidence.png`, `mobile-portfolio.png`, `mobile-research.png` (all within the staging screenshot directory). These show hosted content through a local QA relay; they do not assert that the browser has completed Sites owner SSO. The owner's direct browser sign-in remains a separate access check pending completion.

## Remaining limitations

- Automatic announcement adapters currently cover NTPC, SBI and Maruti, not all NSE companies. SBI's quarterly source registration needs review next quarter. Discovery is bounded and historical backlogs remain visible.
- Maruti PDFs can reject requests; undated CMS items require manual review. Failed downloads and partial coverage are not described as a clean feed.
- Financial extraction and citation checks are conservative, not exhaustive semantic assurance. Scanned PDFs needing OCR and some large/ambiguous documents require manual review; pending jobs are explicit.
- Gemini and upstream sources depend on provider availability and quotas. The hosted audit recorded three `unsupported_classification` responses rejected by evidence validation; their source/rule fallback remained labelled. Successful real research and extraction operations were independently recorded. Retrieval fallback does not claim Gemini success.
- The verified NSE calendar is for 2026. The updater requests maintenance before relying on an unverified year.
- Alerts are stored in-app. Browser push/phone delivery is not implemented. Per-browser session ownership is appropriate for the prototype, not a full identity/account system.
- Staging is owner-private; external ENAM reviewers cannot access it until sharing/promotion is explicitly authorized. Production promotion requires configuring the original Site's own service secret, safely applying its migrations and preparing/verifying demo data there after approval.
