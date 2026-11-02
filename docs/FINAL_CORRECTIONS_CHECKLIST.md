# Final corrections audit — baseline 55b235a

Work remains local in the existing checkout. Database backup taken before incremental migration 0006. Prior verified work is retained.

| Issue verified | Current finding | Correction / acceptance |
|---|---|---|
| Coverage | Counts matching-event companies, affected by category filter | Separate configured/current checked/event companies; zero/failure/filter/new-owner regressions |
| Briefing | SQL LIMIT 200, counters page-derived | Independent stable event/routine cursors and SQL aggregate counts; >200 dataset traversal |
| EOD | Excludes all current IST dates | Clock-injected session metadata, buffer, valid OHLC/adjusted/volume and official calendar; eight timing cases |
| Evidence | First category page, fallback page 1 | Exact event-specific passages/pages and multi-event import; unsupported event requires review |
| Source queue | First run samples two newest then skips earlier cursor range | Durable pending queue, discovery continuation and retry/manual states; no lost intermediate filing |
| Adapters | One registered NTPC table | Shared contract, separate table/list/JSON/admin strategies; verify additional original sources before registering |
| Materiality | Absolute values; CFO appointment/resignation and reaffirmation not sufficiently distinct | Compatible company-scale references, role/action/rating direction and factual explanations |
| Discovery | Type-focused but incomplete ranking/retries | Period/completeness/relevance weighting, bounded durable document jobs, controlled refresh |
| Extraction | Page-wide basis/scale rejects mixed tables; fixed header grammar | Scoped sections, explicit dates/headings, carried multi-page table context; refuse ambiguous columns |
| Gemini | Native SDK and grounding already verified | Preserve; label fact/calculated/commentary/interpretation and test difficult sourced questions |
| Database | Existing integrity/owners/durability pass | Safe migration, original data counts, concurrency, restart and recovery verification |
| Fresh demo | Initial seed works; extra examples need manual imports | Idempotent documented demo preparation + checked-in primary-page bundle for reproducible extras |
| Jobs/live UI | Protected bounded endpoints already exist | Separate stage runners, source retries/progress/freshness and correct reporting; no cloud activation |

Statuses, passing acceptance results, corrected fresh-install and accounting-label findings, and the precise remaining limitations are now recorded in [FINAL_CORRECTIONS_REPORT.md](FINAL_CORRECTIONS_REPORT.md) and [VERIFICATION.md](VERIFICATION.md). No mock company data is added to the investor application.
