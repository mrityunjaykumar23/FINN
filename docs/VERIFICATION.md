# Local upgrade verification — 1 November 2026

Branch: `upgrade/sqlite-gemini-push-pull`. All upgrade work was tested on localhost. No GitHub push, hosted migration or deployment was performed.

| Check | Actual result |
| --- | --- |
| `npm test` | **39 passed**, 0 failed; domain, database, research, AI grounding, fiscal periods and explicit extraction |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, including native Gemini SDK bundled for the retained Worker runtime |
| `npm run test:api` | **15 passed**, 0 failed, against both development localhost:5173 and built-Worker localhost:5174; includes concurrent initialization, empty portfolio persistence, owner-isolated notification state and API validation |
| `npm run test:ingestion` | **1 passed**; concurrent authentic imports with alternate headlines retained exactly one source-page event |
| `npm run test:gemini` | **1 real credential-enabled test passed**, not skipped; authentic Infosys source, valid structured output, accepted citation and provider token usage |
| `py scripts/validate-financials.py` | Independently verified 18 market summaries and 8 original quarterly comparisons |
| `py scripts/validate-dynamic.py` | Independently checked 9 newly extracted consolidated DMART values against their primary pages, and 6 QoQ/YoY calculations; PBT remained unavailable |
| `npm run db:generate` | No remaining schema changes after tracked migrations/snapshots |
| Migration safety | Empty database and original seeded database with custom settings/watchlists passed; original v0 SQL unchanged; existing local database backed up and migrated without reset |
| Clean built-Worker startup | All migrations applied to a separate empty local database; startup created 18-company portfolio, 11 primary documents, 38 metric records and 2 guidance records; all 38 metrics had fiscal year and evidence text; no foreign-key violations |
| Local production preview | `npm start` loads root server secrets as hidden Worker bindings. Bounded mutation-body consumption fixed early-response proxy failures; 30 rejected POSTs were then consistent, and the full built-Worker suite passed including empty DELETE and oversized bodies |
| Foreign keys / source pages | Orphan and cross-company references rejected; metrics/guidance require indexed source pages; shared evidence survives watchlist removal |
| Real application restart | Isolated visitor watchlist, settings, dismissed notification, imported documents/chunks, financial metrics, guidance and AI answer cache matched before/after stopping and restarting the server |
| Gemini research HTTP | Accepted real Gemini answers for Infosys FY2025 CC growth and newly discovered LTTS revenue/risk analysis; actual model `gemini-3.5-flash-lite` |
| Gemini filing pipeline | Authentic HCLTech release classified/summarized as results; accepted 10 metric and 2 guidance extractions, rejected 1 unsupported row during the recorded run |
| New announcement coverage | Imported authentic DMART Q3 results and a separate management-change event from the same NSE PDF; correct category, real date/page, source attribution and persistence |
| Duplicate import | Repeated source/page import returned duplicate count 1 rather than creating another event |
| Unseen ticker | LTTS.NS resolved outside starter/curated coverage; two primary BSE PDFs indexed after safe redirects; relevant source pages cited; oversized annual report excluded explicitly |
| Dynamic guidance | Newly obtained HCLTech FY2024 initial FY2025 3–5% guidance and Q3 revised 4.5–5% guidance matched reported FY2025 CC growth of 4.7%; initial statement labelled superseded; FY2026 target with missing actual refused scoring |
| Background entry point | Protected `sync` job retrieved real LTTS completed EOD observations and evaluated saved owners without a UI-driven calculation path |
| Failure/grounding | Fabricated IDs, wrong-company sources, fabricated quotes/numbers, incompatible units/bases, missing fiscal periods and injected instructions rejected in tests; artificial transport failure unit-tested; actual rejected Gemini summaries produced explicit fallback or substitution by an independently supported finding |
| Mobile UI | Five navigation sections checked at narrow mobile emulation; add/reload/remove restored original watchlist; read/unread changed and restored; evidence drawer, source-linked tables, real Gemini answer and quotes verified; no horizontal page overflow |
| Desktop UI | Research checked at 1440-wide emulation with no horizontal page overflow; screenshot retained |

A stale legacy API assertion expected Asian Paints to have no guidance forever. Real extraction legitimately added a source-backed statement; the test now checks source integrity and refuses incompatible actuals rather than forbidding new coverage. Another extraction edge case mixed nine-month and annual periods; the parser now excludes ambiguous six/nine-month periods, and superseded extraction rows are marked unverified and excluded from analytical inputs.

The local real Gemini key is server-side in ignored `.dev.vars`. It is not part of the source commit. Dollar costs are not estimated without actual billing data; provider-supplied token usage and safe failure codes are recorded. External source access is incomplete and variable, not an exchange-wide guarantee.

Review artifacts: [mobile Gemini answer](screenshots/upgrade-mobile-gemini.jpg), [desktop research](screenshots/upgrade-desktop-gemini.jpg), [local walkthrough](DEMO.md), [limitations](KNOWN_LIMITATIONS.md).

## Archived verification for the earlier published version

The following is the original pre-upgrade record, retained as development provenance. Its deployment and optional-provider statements describe that older version, not this local upgrade.

# Verification record

The public production API also completed uncached COFORGE.NS research: ticker validation, discovery of an authentic BSE PDF, text extraction, indexing and cited retrieval all succeeded. Two additional oversized documents were explicitly reported as unavailable.

Verified locally on 30 October 2026. The project uses real primary documents and daily observations; fictional values exist only in isolated test fixtures.

| Check                                             | Observed result                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| TypeScript                                        | `tsc --noEmit` passes                                                                                 |
| Domain, database and deterministic research tests | 23 tests pass                                                                                         |
| HTTP integration                                  | 9 tests pass against both the local Worker and the public production deployment with persisted D1     |
| Independent Python calculations                   | 18 market summaries and 8 quarterly metric comparisons verified                                       |
| Build                                             | Vinext production build completed; rebuilt again before packaging                                     |
| Historical source ingestion                       | 11 primary PDFs extracted; original URLs and SHA-256 hashes retained                                  |
| Portfolio market ingestion                        | 18 validated symbols × 32 actual daily observations                                                   |
| Cached out-of-portfolio research                  | Asian Paints, Persistent Systems and Avenue Supermarts returned source pages                          |
| Uncached ticker research                          | COFORGE.NS validated; a BSE annual-report PDF was discovered, extracted, indexed and cited            |
| Live source limits                                | Two additional COFORGE documents exceeded the 8 MB interactive limit and were reported as unavailable |
| EOD alerts                                        | Historical SBIN 22 April 2025 volume crossed the default 2× previous-20-session threshold             |
| Missing evidence                                  | An unrelated question returned zero references and an explicit insufficient-evidence response         |
| Protected ingestion                               | Calls without a configured administrator token returned 403                                           |

Browser QA covers the default briefing, 7-day window, evidence drawer, source-page links, company research, promise tracker, portfolio editing and alert settings at desktop and mobile viewports. Screenshots are in `docs/screenshots/`.

The optional external LLM integration has **not** been exercised with a provider key. All demonstrated research ran without one. Production deployment succeeded, public access was verified in the browser, and the entire nine-test HTTP suite passed against the public URL. The source repository is published publicly at [mrityunjaykumar23/FINN](https://github.com/mrityunjaykumar23/FINN).

COFORGE primary source retrieved during the live test: https://www.bseindia.com/xml-data/corpfiling/AttachHis/4a9f4e43-9ca2-4956-8d5f-053e45e7a0ef.pdf . The interactive source period is labelled “Period not verified” until reviewed. Source availability can change, and this single successful test is not a guarantee for every NSE ticker.
