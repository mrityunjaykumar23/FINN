# Latest EOD and automatic financial snapshots — 3 November 2026

Implemented in the existing FINN checkout on `redesign/institutional-intelligence`. The premium interface, Gemini SDK, API architecture, historical sources, visitor portfolios and local configuration are retained. No GitHub push, hosting change or deployment was performed. Review the production build locally at http://127.0.0.1:5173/.

## Observed results

| Company | Accepted financial period | Revenue | EBITDA | PBT | PAT |
|---|---|---:|---:|---:|---:|
| JPL.NS, consolidated | Q2 FY2027 | 40,475 | 21,879 | 11,259 | 8,387 |
| INFY.NS, consolidated | Q2 FY2027 | 49,244 | Insufficient source evidence | 11,063 | 7,838 |
| DABUR.NS, consolidated | Q1 FY2027 | 3,764.39 | Not disclosed in the verified source | 755.65 | 586.16 |

Amounts are INR crore. These are extracted source facts, not newly seeded application figures. Each accepted metric's original document, page and literal evidence were checked through the HTTP API. Opening Research initiates preparation without submitting a research question. Existing verified facts remain available during processing.

Jio's original [results directory](https://www.jio.com/about/investor-relations/financials/financials-results/) supplied the September 2026 results and presentation. Results PDF page 6 establishes the consolidated quarter/half-year figures, rupees/crore and March year end; page 12 contains standalone figures. Presentation page 18 explicitly reports JPL consolidated EBITDA. Its RJIL subsidiary table is not used as JPL evidence. The existing equivalent BSE results document ID and original URL remain intact through content-hash reuse. Currency metadata compensating for its damaged rupee glyph is restricted to that visually verified document hash.

Jio's H1 FY2027 consolidated revenue is 79,648, PBT 21,686 and PAT 16,151. Standalone Q2 FY2027 revenue/PBT/PAT are 4,881/562/419. Browser selection of H1 and Standalone changes the figures and source pages independently. Final group PAT includes associates/JVs; owners' allocation is not substituted for group profit. Operating profit is never silently renamed EBITDA.

Infosys's original [BSE financial package](https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=26c12463-d44e-4050-bd47-b53cc294b4e0.pdf), page 162, verifies its consolidated quarter and half-year table. Page 127 supplies separate standalone figures. The shared parser handles split date headers and statement note references. Dabur's original [BSE results](https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=ce1b1ea9-71f8-4609-a492-95aafc1c3e3c.pdf), page 5, was visually checked: the deterministic parser correctly refuses its damaged currency glyph, and native Gemini extraction subsequently accepts the cited revenue/PBT/PAT. Dabur is outside the original 18-company curated dataset.

## Market behavior and actual provider limitations

- Latest is the default. Historical Replay is explicit; both selections survive reload. Switching modes clears the previous mode's in-memory prices before loading. API defaults remain historical for backward compatibility; investor components explicitly request their selected mode.
- Validated membership is saved before market work is queued. Cached directory validation supports addition independently of a successful chart fetch. A market error leaves the company in the portfolio with its source state and retry control.
- Refreshes use shared ticker locks, a five-minute cooldown, at most three companies per batch, ten automatic UI batches, owner limits and a global 120-refresh/hour budget. One Yahoo operation has a 20-second deadline and at most two HTTP requests.
- JPL's observed latest completed session is **2 November 2026**, close **1,420.699951171875**. Yahoo provides only **one verified daily observation** in these tests. Daily change and relative volume therefore remain null. Its `range=max` response contains 5-minute bars despite the daily request; those are rejected. A bounded earlier-window request did not establish additional daily history. No pre-listing prices or April replay observations are manufactured.
- Infosys and Dabur's actual latest accepted market session is **30 October 2026**, with 62 stored valid daily sessions in this run. Their observed adjusted changes are approximately +3.358046% and −1.189188%; relative volumes are approximately 0.773178× and 0.932063×. The last Yahoo candidate for Infosys on 2 November has both `close=null` and `adjclose=null`. Missing closes are never filled from open/high/previous prices. Freshness identifies the older observation against the expected completed session of 2 November.
- A completed daily bar with a real raw close but missing adjusted close can now be stored separately. It displays the real price with `adjusted_close=null`; percentage arithmetic remains unavailable. Charts use one consistently labelled raw series when adjusted observations are missing. Volume comparisons are independent and require the configured number of prior valid observations.

## Implementation and modified files

| Area | Files and changes |
|---|---|
| Market ingestion | `lib/yahoo-data.ts`, `lib/market-sessions.ts`, `lib/market-state.ts`, `lib/market-refresh.ts`, `lib/server.ts`, `lib/domain.ts`, `lib/types.ts`: exact-symbol daily validation, listing cutoffs, raw-only prices, completed-session freshness, adjusted arithmetic and bounded asynchronous refreshes |
| Investor UI | `components/Dashboard.tsx`, `components/Portfolio.tsx`, `components/Briefing.tsx`, `components/Research.tsx`, new `components/FinancialSnapshot.tsx`, `app/institutional.css`: persisted Latest mode, actual dates, retry/error states, automatic snapshots, period/basis selectors and existing responsive styling |
| Financial pipeline | `lib/pdf-financials.ts`, `lib/financial-snapshot.ts`, `lib/ingestion/discovery.ts`, `lib/ingestion/document-jobs.ts`, `lib/ai/service.ts`, `lib/periods.ts`, `lib/research-jobs.ts`, `data/financial-sources.json`: bounded primary-source discovery, retained PDF geometry, verified fiscal periods, literal financial labels, deterministic extraction and native Gemini fallback |
| Routes | `app/api/[...path]/route.ts`: additive portfolio/company market-refresh routes and owner-scoped snapshot start/status/advance routes; existing routes retained |
| Database | `db/schema.ts`, `drizzle/0010_giant_cyclops.sql`, `drizzle/0011_third_deathstrike.sql`, migration journal and snapshots |
| Verification | `tests/latest-data.test.ts`, three original-PDF layout fixtures, `tests/database.test.mjs`, `tests/domain.test.ts`, `scripts/verify-latest-data.mjs`, `package.json`, this report and `docs/test-results/latest-data/` |

Snapshot work uses the existing durable research/document-job infrastructure with a separate `purpose`. Discovery, indexing, extraction and completion are distinct phases. Results and presentation candidates proceed independently. Earlier failed attempts remain in the audit without hiding the currently selected successful source. A parser-version upgrade can recheck indexed originals, retaining original chunks and provider attempt counts. Failure cannot produce a false completed financial-extraction status.

Discovery caches primary candidates for 24 hours; an explicit refresh can recheck after a five-minute shared discovery cooldown. Actual discovery is limited to 12 attempts/company/hour. Preparation has a one-minute explicit retry cooldown, owner limits, leases and bounded polling. Source directories supply links only; their financial tables never become primary evidence.

## Database safety

Migration 0010 adds `document_layouts` and `research_jobs.purpose`; existing jobs default to `research`. Migration 0011 adds `unadjusted_daily_prices` without modifying the existing non-null adjusted-price table. Both are additive; no existing table or data is deleted/reset. Old adjusted observations supersede the same session's retained raw-only record in reads. Listing cutoffs filter invalid early observations without deleting audit history.

Backups preceded migration. Applying both SQL files to a separate copy of the populated pre-change backup preserved row counts in **all 33 existing non-system tables**, including FTS tables. Integrity was `ok`; foreign-key violations were zero. The working database also passes integrity/foreign-key checks. Financial snapshots and original sources remained available after restarting the production preview. `.dev.vars`, keys, local database files and backups remain ignored and were not published.

## Verification

| Check | Result |
|---|---|
| Unit/database/regression tests | 89 passed |
| API integration | 17 passed |
| Reliability API | 4 passed |
| Native Gemini with real configured credentials | 3 passed |
| Authentic announcement ingestion | 1 passed |
| Durable research jobs | 1 passed |
| Real answer-cache invalidation, isolated database | 1 passed |
| Authentic demo preparation, isolated database | 1 passed |
| Total named automated tests | **117 passed; 0 failed; 0 skipped** |
| TypeScript, ESLint, production build | Passed |
| Three-company latest-data HTTP acceptance | Passed |
| Independent financial validation | 18 historical market summaries, 8 quarterly comparisons, 9 DMART values/6 percentage calculations, 5 Britannia values passed |
| Browser | Latest/replay reload persistence; Jio automatic preparation, quarter/half-year and basis selectors; 320/375 mobile and 1440 desktop layouts checked |

Machine-readable results and logs are in [test-results/latest-data/summary.json](test-results/latest-data/summary.json). Screenshots are in [screenshots/latest-data](screenshots/latest-data). The existing vinext dynamic-route classification notice is informational; the production build completed.

Remaining limits: Yahoo can return delayed/incomplete daily observations; it supplies insufficient JPL history in this run. Public-source discovery and PDF/Gemini extraction are bounded and best effort, not exchange-wide or universal OCR coverage. Unsupported metrics and fiscal evidence stay unavailable. This local verification does not establish hosted scheduling, hosting quotas or production readiness; deployment remains a separate authorized step.
