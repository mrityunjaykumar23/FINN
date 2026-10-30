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
