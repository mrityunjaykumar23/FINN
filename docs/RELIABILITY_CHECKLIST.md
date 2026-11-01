# Reliability upgrade checklist

Working baseline: 9378c42, existing checkout, local-only. Current data backed up with `db:backup` before migration. Status is updated with actual verification.

| Request | Relevant files / verified existing behaviour | Required change / regression |
|---|---|---|
| A financial integrity | research-analysis hardcodes FCF FY2025; periods already reject negative/zero bases and incompatible units | Dynamic cash period, signed capex, verified/restated/conflicting duplicate selection; year/basis/currency regressions |
| B event identity | workflows hashes document+page; merges distinct events | Document / exchange filing / evidence-event identity; two same-page events and headline variants |
| C/L discovery & jobs | protected imports and market jobs work; no announcement discovery job | Bounded original-source adapter/manual fallback, resumable company cursor, independent failures, persisted counts |
| D materiality | category defaults, magnitude zero | Evidence-derived attributes, neutral unknown, factual score explanations; same-category magnitude tests |
| E discovery | first three PDF links, refresh endpoint exists | Task-ranked bounded candidates, metadata/progress and controlled stale-library refresh |
| F retrieval | FTS hits remapped into first 2500 rows | Direct filtered database FTS joins, synonyms, late-chunk/company/period tests |
| G extraction | conservative prose and validated Gemini already work | Document-aware passage selection, unambiguous table grammar, rejection audit; preserve unknowns |
| H Gemini | native SDK, budgets, citation checks, fallback already work | Optional task routing, qualifier/contradiction tests, real provider calls |
| I cache | documents/metrics/model hashed, guidance missing | Company-scoped content revision covering chunks/guidance/derivations/retrieval version |
| J pagination | feed capped at 500; detail searches list | Direct primary-key lookup, stable cursor+filters, >500 regression |
| K search | local name substrings work; unknown input treated as ticker | Verified directory name path, metadata, explicit unresolved state |
| M guidance | exact unit/basis/period matching and revision display work | Verified statement filtering, safe revision matching, source timeline, dynamic example |
| N/Q database/security | safe bindings, FKs, source-page triggers, owner cookies, body drain already work | Incremental migration only; preserve IDs/state; exercise migration, concurrency, isolation |
| O/P reliability/UI | existing design and mobile navigation preserved | Compact accurate coverage/progress; test controls, mobile and restart |

Implementation and acceptance results are recorded in VERIFICATION.md. No ZIP, publication, deployment or database reset is part of this work.

## Completion

All P0 and P1 rows above are implemented and verified within their documented source/format limits. Specifically: A/B/D/F/I/J have financial, identity, materiality, scale and invalidation regressions; C/L have actual successful official NTPC discovery plus a successful zero-new-filings check and protected manual fallback; E/K have actual uncached Britannia name resolution and original-source retrieval; G/H/M have primary-source financial audits, real Gemini and dynamic HCL guidance checks; N/Q have preserved populated migrations, owner isolation, provenance, integrity and actual restart; O/P have final build/API and mobile checks. P2 universal OCR, semantic infrastructure and biography enrichment remain excluded. See [actual pass counts and limitations](VERIFICATION.md).
