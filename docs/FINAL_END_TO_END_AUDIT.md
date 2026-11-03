# FINN end-to-end audit — 3 November 2026

The existing checkout was upgraded in place from `76c24d1` on `redesign/institutional-intelligence`. The navy/teal interface, logo, TypeScript/Workers architecture, native Google GenAI client, SQLite/D1, anonymous sessions and original 18-company portfolio are retained. No project replacement, database reset, credential replacement, GitHub push or deployment was performed.

## Baseline before implementation

All 117 existing named tests passed: unit/database 89; API 17; reliability API 4; real Gemini 3; durable research 1; authentic ingestion 1; isolated answer cache 1; isolated fresh demo 1. No test was skipped. TypeScript, ESLint and the production build passed. The existing independent Python financial, DMART and Britannia validations passed. Cache and demo tests used separate freshly migrated local test databases; the working database was preserved.

Baseline evidence remains private under `.sites-runtime/end-to-end-20261103/baseline/`. Final public-safe logs and results are in `docs/test-results/end-to-end/`.

## Ajanta reproduction and first failure

- Company: `AJANTPHARM.NS`, validated by the existing official NSE security directory.
- First failed operation: original document download, before indexing or financial extraction.
- Source: `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=b3814f9a-c2b6-4c22-a94b-52fcdd2b9454.pdf`.
- Durable document job: `27ca69550ee25a5af43c056e67e042befe68fb045138c4a22ca0f7d658d87ea1`.
- Exact safe error: `The operation was aborted due to timeout`; attempt 1, status `failed`, no document ID, indexed document, accepted metric or extraction audit. Gemini had not been invoked for that failed download.
- Parent snapshot nevertheless reported `complete`; aggregate child failure produced four “Extraction failed” states. This conflated source-download failure with attempted per-metric extraction.
- A controlled retry on the unchanged baseline subsequently downloaded the source and accepted rounded revenue 1,794 and PAT 388 from page 2 for Q2 FY2027. PBT and EBITDA remained unavailable. Both accepted rows had unit `Rs. cr.` but null currency/scale metadata. This partial recovery does not establish complete extraction.

## Verified source alternatives

The official Ajanta quarterly-results page and the supplied NSE integrated financial filing both returned HTTP 200. The company page supplies current and previous quarterly presentation/press-release links. The NSE HTML contains eight structured tables, explicit company identity, financial-year start/end, INR/lakhs, statement scope and separate quarter/year-to-date contexts. It is a rendered structured financial filing, not a PDF and not a page containing inline `ix:nonFraction` facts.

Sources:

- https://www.ajantapharma.com/ajanta/Investors/quarterly_results
- https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_207120_30102026151430_iXBRL_WEB.html

## Confirmed gaps before implementation

1. `parseCandidates` accepts only an HTTPS company-website link. Ajanta's directory identifies its official website with HTTP, so the original official host is missed. Crawling original investor relations pages and selecting relevant alternative sources is absent for unregistered companies.
2. Snapshot discovery selects the first results URL and first presentation URL, leaving a single failed or incomplete source as the entire financial coverage.
3. All document imports require a PDF magic header; structured official HTML/XBRL facts cannot enter the shared evidence pipeline.
4. Deterministic PDF tables require INR/crore. Original lakhs, other explicit scales and proper per-share units are unsupported.
5. Model-derived unit strings are not canonicalised consistently; accepted `Rs. cr.` rows demonstrate missing metadata.
6. Snapshot/backend and frontend aggregate-error logic can label never-attempted metrics as extraction failures.
7. API market/digest defaults remain historical. The live briefing has fixed FY2025 promise-tracker content and fixed April custom-date defaults.
8. Detailed financial calculations, sector applicability and structured-source evidence locations need expansion and explicit verification.

## Final status

| Area | Status | Actual evidence |
|---|---|---|
| Ajanta extraction | Implemented and locally verified | Fresh automatic original-source discovery produces all four Q2 FY2027 metrics; supplied NSE HTML separately verifies exact lakh facts |
| Units, periods and scope | Implemented and locally verified | Original/normalized values, quarter versus H1, per-share units, verified fiscal calendars, genuine Ajanta/Havells fixtures |
| Lifecycle and recovery | Implemented and locally verified | Per-metric states; source failure cannot become four failed metric attempts; accepted facts survive another source or storage failure |
| Latest defaults | Implemented and locally verified | Live API/portfolio/digest/filings defaults, explicit replay, dynamic briefing, latest guidance targets, current answer-period financial table |
| Yahoo EOD and additions | Implemented and locally verified | Havells addition plus JPL/Infosys/Dabur acceptance; OHLC/provider/completion stored; adjusted returns and prior-20 relative volume |
| Native Gemini PULL | Implemented and locally verified | Real Havells answer, eight checked references, provider usage; direct research/guidance/risk tests pass |
| Automatic PUSH | Implemented and locally verified | Fresh ITC discovery → ingestion → classification → personalized briefing → persistent alerts through owner-scoped monitor routes |
| Migration and durability | Implemented and locally verified | Every original value/count preserved across 29 populated tables; actual stop/start preserves membership, settings, dismissal, facts and Gemini job |
| Financial arithmetic | Implemented and locally verified | Conditional margins, growth, TTM, CAGR, leverage, liquidity, cash conversion, FCF, annual average-capital returns and working-capital measures |
| General source coverage | Partially implemented with limitations | Bounded issuer crawl, exchange originals, directory fallbacks and cached catalogue; unavailable, oversized and unsupported reports remain explicit gaps |
| XBRL/inline facts | Implemented but requires provider verification | Context/unit/scale/sign/nil/dimension tests pass; real rendered NSE HTML verified; separate live raw XBRL/ix:nonFraction acceptance not claimed |
| Scheduled execution | Implemented but requires provider verification | Protected bounded local phases/cursors pass; no hosted recurring schedule activated or asserted to run |
| OCR, embeddings, external notifications | Intentionally excluded | Text-based extraction and persistent in-app alerts retained |

## Ajanta acceptance

| Q2 FY2027 consolidated | Original NSE fact | Normalized INR crore | Other original disclosure |
|---|---:|---:|---|
| Revenue | 179,416 INR lakh | 1,794.16 | Presentation/press release rounds to 1,794 |
| EBITDA | Not in this NSE statement | 543 | Original investor presentation, file page 36 |
| PBT | 53,515 INR lakh | 535.15 | Presentation rounds to 535 |
| PAT | 38,814 INR lakh | 388.14 | Presentation rounds to 388 |

Exact structured statements outrank rounded summaries. Equally authoritative conflicting values stay unavailable. EBITDA is separate from adjusted EBITDA; growth/margin columns are not absolute financial values.

A second fresh database, with **no supplied NSE import**, automatically followed original IR links and returned Revenue 1,794, EBITDA 543, PBT 535 and PAT 388 from rounded company disclosures. All four states were Verified, Q2 FY2027, consolidated, readiness ready. A repeat request created zero financial records. These rounded disclosures do not replace the exact NSE facts in the working database.

The NSE H1 statement separately provides Revenue 3,420.12, PBT 981.95, PAT 722.36 and OCF 749.52 crore. H1 FCF is 490.49 crore using OCF minus absolute PPE and intangible cash purchases, excluding acquisitions. EPS 31.07 stays INR/share. H1 figures are never relabelled quarterly.

The cold test also caught equivalent basis spelling being treated as conflict: “Consolidated reported INR” versus “consolidated reported currency.” Comparison now recognizes the verified currency while preserving explicit IFRS/Ind AS, adjusted and constant-currency differences.

## Unfamiliar-company PULL

Havells (`HAVELLS.NS`) is outside the original portfolio. Its first cold run exposed archive ranking: descriptive old financial-results titles outranked recent information updates. Relevant report types now prefer the newest reporting period. Voting results are excluded from financial results, and embedded CSS cannot become a report title.

Havells exposed rotated PDF coordinates and an embedded-font closing-parenthesis artefact in a currency caption. Orientation normalization and strict unit recognition prevent a crore table becoming base rupees. Cached horizontal layouts are reused; old rotated geometry may need one recapture. The affected earlier output was reverified from the cached original without redownloading it.

Q2 FY2027 consolidated Revenue is 6,431.99 crore, PBT 472.62 and PAT 349.22, citing original statement file page 9. Consolidated EBITDA is not disclosed in the checked statement. The standalone presentation explicitly reports EBITDA 576 crore; changing basis keeps it separate. Exact standalone statement revenue 6,416.62 outranks rounded 6,417.

Native Gemini returned a successful current-company answer with eight checked references and actual recorded usage (15,279 input / 1,165 output tokens for the verified answer). Every cited source ID/document/page was checked against persisted company evidence, with literal excerpt linkage. Equivalent requests reused the cache. Direct SDK research, guidance and risk tests also pass. Deterministic parsing/calculation is not labelled a Gemini call.

An additional Ajanta browser growth request was rejected with `invalid_schema_or_company`. It correctly displayed deterministic calculations and genuine structured citations, not a successful AI answer. This provider-response limitation is retained explicitly; the separate Havells native PULL and three direct Gemini tests passed.

The research report shows authoritative facts for its current or explicitly requested period, retains historical comparisons, and labels HTML/XML citations as structured sections rather than PDF pages.

## Authentic PUSH

A fresh database and dedicated visitor retained ITC alone in its test portfolio. The same owner-scoped start/status/advance routes used on opening processed these real 2 November 2026 disclosures:

- [ITC/Sproutlife amalgamation](https://itcportal.com/content/dam/itc-corporate/stock-exchange-/2026/lodr-02nov26b.pdf), file page 3, event `84aa6b921c367962be57e292`.
- [ITC integrated financial filing](https://itcportal.com/content/dam/itc-corporate/stock-exchange-/2026/lodr-02nov26a.pdf), file page 10, event `0b1baa0234dcc6bbc1ce2c2b`.

Original quotations matched indexed pages. Both reached personalized briefing and persistent alerts. Another visitor received 404 for the monitor job. Publication stayed date-only. The next check reused freshness: six hours after success, five minutes after failed/manual coverage, with at most three companies per job, bounded durable phases, leases and budgets.

Financial-note transaction references and cash-flow “Dividend Income” lines now stay review items rather than new material events. Briefing excludes review-required records consistently with announcements and notifications. Existing records and alert lifecycle state are preserved.

The original 17 categories, priorities, thresholds, idempotent event IDs and independent-candidate failure isolation remain. Four registered dated issuer adapters provide source-specific coverage. Undated directory originals require review. Similar results in separate authentic documents can appear as related separate filings; universal semantic deduplication is not claimed.

## Supported financial arithmetic

Accepted records retain original/normalized value, unit, currency and scale, period/start/end/kind, basis, original document/location, method and verification state. Structured raw source and contexts are persisted. No FX conversion is performed.

Conditional on compatible verified inputs:

- Revenue, reported EBITDA/EBIT/operating profit, PBT/PAT, explicit EPS and margins.
- QoQ/YoY/annual growth, four consecutive-quarter TTM and positive-endpoint annual CAGR.
- Assets/liabilities/equity, borrowings/debt/cash, liquidity and debt/borrowings-to-equity.
- Operating/investing/financing cash flow, explicit capital spending, FCF and OCF/PAT.
- Annual ROE/ROCE using average opening/closing balances; no silent annualization of quarters.
- Annual inventory/receivable/payable days using actual reporting days and balances. Revenue/COGS proxies are labelled and are not asserted to be exact credit sales/purchases or an official operating cycle.

Missing, zero or unsuitable denominators, conflicting facts and missing comparison periods return insufficient evidence. Industrial EBITDA/cash/working-capital measures are not forced onto financial companies. Additional prudential banking/insurance ratios are not established by these acceptance cases.

## Database, fault recovery and restart

`0012_dear_wolverine.sql` adds source format, original/normalized financial metadata, document error stage/code, OHLC/provider/completion columns, `source_payloads` and `metric_processing`. It uses additive CREATE/ALTER statements; no deletion/reset of existing data.

A populated pre-migration backup was copied into an isolated path, 0012 applied, and all original columns/values/counts compared by hash across **29 existing tables**. All matched. Full migrations passed on fresh databases. Drizzle reports no schema drift; integrity is `ok`, with zero foreign-key violations.

Controlled faults were confined to an isolated database:

- A temporary trigger rejected financial INSERTs. D1's atomic batch rolled back prior withdrawal and all numeric writes; all 34 accepted facts stayed unchanged.
- Removing the trigger allowed recovery with the same retrieval timestamp/hash and zero duplicate facts. No redownload occurred.
- A deliberately missing source failed at download with `source_unavailable`, no document ID and attempt 1. Immediate retry processed nothing and did not increment attempts.
- Invalid PDF bytes, ambiguous units/calendars/scopes, malformed numeric tokens, external entities, missing calculation inputs and Gemini rate limits have regression coverage.

An actual stop/start preserved a dedicated visitor's 19-company test portfolio, rule, dismissed alert, completed successful Gemini job, 95 accepted Ajanta facts and 141 accepted Havells facts. The browser visitor's original 18 companies remain intact. Documents/chunks, structured payloads, announcements and market observations remain in the working database.

## Final verification

**136 named tests passed; zero failures and zero skips.**

| Suite/check | Result |
|---|---|
| Unit/database/domain/financial/source regressions | 108 passed |
| Existing API integration | 17 passed |
| Reliability API | 4 passed |
| Real native Gemini research/guidance/risk | 3 passed |
| Durable research / authentic ingestion / fresh cache / fresh demo | One passed each |
| TypeScript / ESLint / production build | Passed; no type errors or lint warnings |
| Independent Python validation | 18 market summaries, 8 quarter comparisons, 9 DMART figures + 6 calculations, 5 Britannia figures passed |
| Latest-data acceptance | JPL, Infosys and Dabur passed with real completed observations and available financial facts |
| Extra acceptance | Cold automatic Ajanta, ITC PUSH, Havells PULL, atomic recovery, populated migration and actual restart passed |
| Protected scheduled phases | Unauthorized rejected; bounded local market batch/evaluation cursor accepted; fresh cache reused |
| Responsive browser | Five mobile navigation views, basis switching/details, 320/375/1440 viewport checks with no horizontal page overflow; desktop Gemini answer rendered |
| Secrets | `.dev.vars` preserved/ignored; zero configured secret-value matches in source/client scan |

Historical API tests now explicitly request replay. The dated-table fixture supplies a verified fiscal calendar; quarter headings cannot assume March. These are intentional requirement changes.

Public-safe evidence: [test-results/end-to-end](test-results/end-to-end). Private diagnostics, source captures and database copies remain ignored in `.sites-runtime/end-to-end-20261103/`. Browser proof: [screenshots/end-to-end](screenshots/end-to-end).

## Local readiness and limitations

The final production build runs at **http://127.0.0.1:5173/** using the existing SQLite state. Latest is normal operation; Historical Replay retains April 2025. No production deployment, push or hosted schedule was changed.

Local workflows are ready for review. Issuer accessibility, Gemini quotas, oversized/scanned/unsupported reports, incomplete coverage and future exchange-calendar maintenance remain real limitations. Interactive durable jobs advance while a client polls or a protected worker is advanced; they are not an independently running hosted queue. Hosted recurrence, secrets and deployment-specific persistence need separate deployment verification and authorization.

## Modified-file groups

- Financial adapters, definitions, units, context, storage and calculations: new `lib/financial-*.ts` helpers, `structured-financials.ts`, `snapshot-state.ts`, `source-references.ts`; updates to `pdf-financials.ts`, `financial-extraction.ts`, `periods.ts`, `financial-snapshot.ts`.
- Ingestion/discovery/retry: `lib/ingestion/discovery.ts`, `document-jobs.ts`, new `structured-source.ts`, and `lib/event-evidence.ts`.
- Durable PUSH/PULL and routes: `monitor-jobs.ts`, `research-jobs.ts`, `research-analysis.ts`, `scheduled-jobs.ts`, `server.ts`, `query-plans.ts`, `briefing-query.ts`, `app/api/[...path]/route.ts`.
- Native Gemini: `lib/ai/service.ts`, `provider.ts`, `gemini.ts`.
- Market and contracts: `market-refresh.ts`, `market-sessions.ts`, `domain.ts`, `types.ts`.
- UI: `FinancialSnapshot.tsx`, `Research.tsx`, `ResearchReport.tsx`, `Briefing.tsx`, `PromiseTracker.tsx`, `Dashboard.tsx`, `common.tsx`; minimal `app/institutional.css` additions.
- Database: `db/schema.ts`, migration 0012 and matching Drizzle snapshot/journal.
- Tests/dependency: `tests/end-to-end.test.ts`, authentic Ajanta/Havells fixtures, explicit-mode/calendar adjustments to existing API/database/corrections tests; `htmlparser2` package/lockfile additions.
- Documentation: this audit, verification/limitations notes, public-safe test logs and screenshots.
