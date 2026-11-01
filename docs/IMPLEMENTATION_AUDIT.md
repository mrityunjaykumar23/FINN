# Current reliability audit — 2 November 2026

The requested weaknesses were verified against 9378c42 and addressed in this same checkout. [The checklist](RELIABILITY_CHECKLIST.md), [change report](RELIABILITY_UPGRADE.md), and [actual verification](VERIFICATION.md) distinguish preserved implementations, new fixes and remaining limitations. The earlier audit below is retained as build history, not a list of currently unresolved defects.

# FINN implementation audit

Audit baseline: public source commit ed262f46, 31 October 2026. Work happens on `upgrade/sqlite-gemini-push-pull`, localhost only. No GitHub push or deployment is part of this upgrade.

## Preserved behaviour

React/Vinext Worker, SQLite/D1, Drizzle migrations, mobile navigation, 18-company starter watchlist, 576 authentic historical EOD observations, adjusted price changes, previous-session volume baseline, 17 filing categories, explainable ranking, page-level PDF evidence, 11 primary documents, 36 reviewed metrics, deterministic research, optional synthesis, and two Infosys guidance examples. Existing financial tests and independent Python calculation audit remain regression checks.

## Gaps and weaknesses

- Owner identity trusts a caller-supplied header. Owner initialization spans multiple transactions and uses miscellaneous metadata. No owner foreign keys.
- Tables have primary/unique keys but lack relational constraints. Announcement and alert filtering depends on JSON. Alert replacement loses lifecycle state.
- Guidance is read directly from seed JSON. Research and financial tables assume FY2025 periods. PDF insertion can leave partially indexed documents.
- Optional generic LLM adapter has no demonstrated real credential test, robust output grounding, usage budgets or provider telemetry.
- Four curated events cover two companies. Document discovery exists but has no sync ledger, controlled refresh, or full filing-to-briefing workflow.
- No notification read/dismiss interface; no protected local batch ingestion/evaluation runner. No scheduled jobs configured.
- Source access can fail; scanned/oversized PDFs cannot be indexed interactively. A link directory is discovery, never financial evidence.

## Implementation sequence

1. Add a non-destructive incremental migration, owner records, queryable filing/metric/alert fields, guidance tables, ingestion state, cache metadata and budgets. Back up existing local SQLite first.
2. Make owner initialization atomic, cookies unspoofable by headers, and ingestion/alerts idempotent. Preserve existing portfolios/settings.
3. Add official Gemini SDK, structured schemas, bounded retry/timeout/concurrency, citation/excerpt/number checks, extraction and research caches. Clearly label offline/failure states.
4. Generalize period selection, document metadata, financial and guidance extraction/storage/comparison. Integrate filing import, discovery and market sync with run ledgers and notification evaluation.
5. Extend existing screens with coverage/status, notification state and dynamic period/company controls.
6. Run migrations against empty and populated databases; regression, API, durability, source import, optional real Gemini and mobile tests. Commit locally.

## Acceptance criteria

No shared evidence is deleted by watchlist removal. Owner initialization occurs once even concurrently and an empty watchlist stays empty. Spoofed identity headers have no effect. Foreign keys, deduplication, source consistency and owner-isolated read/dismiss state are tested. New filings and derived financial comparisons retain primary references. Period/basis mismatches refuse comparison. Sync failures differ from successful empty results. Gemini output is accepted only through schema and evidence validation; missing credentials and rejected answers fall back explicitly. Real provider tests are opt-in and cannot be reported passed without credentials. Existing tests, typecheck, build, HTTP integration, Python calculations and mobile checks must actually run.

## Deliberate exclusions

Login/signup, stack rewrite, PostgreSQL, access-control bypass, investment price predictions, fabricated coverage, unconditional cloud deployment, GitHub pushes, costly semantic infrastructure and scraped personal biographies. PUSH means persisted in-app notifications and protected batch evaluation; phone/browser delivery is outside this implementation unless separately configured. Scheduled cloud ingestion is deferred until local review.
