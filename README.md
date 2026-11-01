# FINN — Investment Intelligence

FINN turns primary company disclosures and stored end-of-day observations into a portfolio briefing, evidence-grounded company research, and management guidance comparisons. No login or signup.

This upgrade is on **`upgrade/sqlite-gemini-push-pull`**, for localhost review. It has not been pushed to GitHub or deployed. The [public repository](https://github.com/mrityunjaykumar23/FINN) and [public demo](https://finn-investment-intelligence-mrity.hazyanole2049.chatgpt.site) still describe the earlier published version.

The final reliability upgrade is described in [the change report](docs/RELIABILITY_UPGRADE.md), with [actual verification](docs/VERIFICATION.md). It adds source-derived event identity/materiality, bounded announcement jobs, database-first FTS, guidance-aware caches, ordinary-name search and resumable file indexing while preserving the existing application.

## Run locally

Node 24, npm, and optional Python 3.11+:

```sh
npm ci
npm run db:migrate:local
npm run dev -- --host 127.0.0.1
```

For a local production preview after `npm run build`, use `npm start` (default port 8787); the launcher explicitly loads the root `.dev.vars` as hidden server bindings. Stop that preview before rebuilding on Windows.

Open [localhost:5173](http://127.0.0.1:5173). Migrations preserve the historical snapshot and existing portfolios/settings. SQLite lives in ignored `.wrangler/state/`. The first request seeds a fresh database; a visitor receives 18 starter companies exactly once. An empty watchlist stays empty.

For an older checkout with tables but no Wrangler migration ledger, first run `npm run db:backup`, then `node scripts/adopt-local-baseline.mjs`, then migrate. Adoption verifies the original schema before registering it; it never resets financial data. See [database backup and recovery](docs/DATABASE_DESIGN.md).

## Gemini configuration

Copy `.env.example` to ignored `.dev.vars`, enter values locally, then restart the server. Never paste keys into chat or put them in frontend variables.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-only Google API key |
| `AI_ENABLED` | `true` enables configured Gemini; `false` forces extractive/offline mode |
| `GEMINI_MODEL_FAST` | Configurable extraction, classification and research model |
| `GEMINI_MODEL_REASONING` | Optional research model for guidance, risks, cash quality and complex narrative questions; defaults to the fast model |
| `ADMIN_TOKEN` | Long random server secret for imports and batch jobs |
| `FINN_TEST_URL` | Local integration-test origin, default `http://127.0.0.1:5173` |

Native `@google/genai` 2.32.0 is used. Real credentialed tests and complete localhost research succeeded with **gemini-3.5-flash-lite**. The model is configurable; availability and quotas depend on the key/project. Official [models](https://ai.google.dev/gemini-api/docs/models), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), and [SDK](https://googleapis.github.io/js-genai/) were checked during implementation.

Missing credentials, provider failures, unsupported responses and budget limits produce explicitly labelled source retrieval and deterministic calculations. They never pretend to be Gemini output.

## PUSH: filings and alerts

The historical replay remains separately labelled, with authentic April 2025 prices and primary disclosures. Current observations never replace replay data. Filing dates without reliable times use inclusive calendar-day filtering; the UI labels this accurately.

A protected import accepts an authentic primary PDF URL or an already indexed document. It validates company association, downloads permitted HTTPS sources, follows bounded primary-host redirects, extracts actual PDF pages, deduplicates content, classifies, explains ranking, extracts supported facts and stores a briefing event. All 17 categories remain supported. A source ledger distinguishes successful checks, partial discovery and failure from an empty result.

Use the local job runner; it reads `ADMIN_TOKEN` from `.dev.vars` in memory:

```sh
npm run job:local -- filing docs/examples/dmart-q3.json
npm run job:local -- filing docs/examples/hcl-fy24.json
npm run job:local -- filing docs/examples/hcl-q3fy25.json
npm run job:local -- extract docs/examples/dmart-extract.json
npm run job:local -- sync
npm run job:local -- evaluate
npm run job:local -- replay
```

`sync` refreshes completed EOD observations for monitored tickers and evaluates all stored owners. Optional JSON `tickers` narrows the bounded job. `evaluate` checks current completed EOD sessions and material filings for stored owners; `replay` evaluates historical observations. These are callable background jobs independent of a browser. No cloud schedule, browser push or phone delivery has been activated.

Notifications persist read/unread/dismiss state per visitor. Re-evaluation cannot duplicate an event or erase its lifecycle. Settings affect newly evaluated signals; history remains accessible.

## PULL: company research

Search a valid NSE ticker independently of portfolio membership. Unknown symbols are validated against Yahoo daily data. Primary PDF links are discovered through a public directory; its financial tables and opinions are never evidence. Explicit safe source imports remain available when discovery is restricted.

The pipeline uses SQLite FTS5 plus ticker/period/type-filtered lexical retrieval, page references, deterministic financial calculations, bounded Gemini synthesis, strict Zod validation and evidence checks. Every material model claim carries real source IDs and a literal supporting excerpt. Wrong-company sources, fabricated quotes, unsupported numbers and incompatible periods are rejected. Automated checks establish source linkage, not complete semantic proof; limitations stay visible.

Research exposes model/execution status, citations, financial metrics, commentary, positive factors, risks and evidence coverage. Available fiscal periods drive the tables. QoQ/YoY comparisons match unit and accounting basis. Derived quarterly comparisons retain both input metric references in SQLite. Missing EBITDA and incompatible definitions remain unavailable.

Management guidance is stored in SQLite, including targets/ranges, periods, units, basis, original quotes and revisions. Reported actuals are matched conservatively. The original Infosys examples remain; dynamic HCLTech initial/revised FY2025 guidance and its actual were also tested.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health`, `/api/status` | Health, source coverage, provider configuration and bounded operational statistics |
| GET, POST | `/api/portfolio` | Owner-isolated watchlist |
| DELETE | `/api/portfolio/{ticker}` | Remove only this visitor's association |
| GET | `/api/market/{ticker}` | Stored series, `mode=historical` or `live` |
| POST | `/api/market/refresh` | Retrieve completed current sessions |
| GET | `/api/digest`, `/api/announcements` | Queryable filing windows and signals |
| GET | `/api/announcements/{id}`, `/api/documents/{id}` | Primary evidence and financial tables |
| GET, PUT | `/api/alerts/settings` | Persistent thresholds/category/company rules |
| GET | `/api/alerts?status=unread` | Owner-isolated history |
| PATCH | `/api/alerts/{id}` | `status`: unread, read or dismissed |
| POST | `/api/alerts/evaluate` | Evaluate this visitor's stored data |
| GET | `/api/companies/search?q=...`, `/api/companies/{ticker}/overview` | Ticker resolution and source/metric overview |
| POST | `/api/research` | Ticker/question with optional period/type |
| POST | `/api/companies/refresh-documents` | Bounded source discovery with cooldown |
| GET | `/api/guidance`, `/api/research/{ticker}/guidance` | Database-backed comparisons |
| POST | `/api/admin/ingest-document`, `/api/admin/ingest-announcements` | Protected primary-source import |
| POST | `/api/admin/extract-document`, `/api/admin/ingest-market`, `/api/admin/evaluate-alerts` | Protected extraction and background jobs |

Mutations validate input and same-origin requests. Responses use structured errors. Admin credentials never enter React. Random HttpOnly cookies establish anonymous ownership; untrusted identity headers have no authority. Session/global provider budgets, shared SQL concurrency locks, request-size limits, PDF limits, finite retries and cached identical analyses bound public API costs.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run test:api
npm run test:gemini
npm run test:ingestion
py scripts/validate-financials.py
```

The real Gemini test is opt-in through local server credentials and explicitly skipped without them. HTTP upgrade mutation tests accept localhost only. Test fixtures are isolated from the browser watchlist. See [actual verification evidence](docs/VERIFICATION.md), [architecture](docs/ARCHITECTURE.md), [AI pipeline](docs/AI_PIPELINE.md), [limitations](docs/KNOWN_LIMITATIONS.md), and [local demo](docs/DEMO.md).

Original source rebuilding remains available through `scripts/ingest.py` and `scripts/build-seed.py`; downloaded PDFs stay ignored. Existing public deployment and GitHub publication are unchanged until the user reviews and requests release.

## Reliability jobs and acceptance

```sh
npm run job:local -- sync-announcements
npm run job:local -- sync
npm run job:local -- filing docs/examples/ntpc-capacity.json
npm run test:reliability-api
py scripts/validate-retrieved.py
```

Jobs return company and owner continuation cursors. Pass `after` and `owner_after` in the optional JSON input to resume. The official NTPC adapter samples two latest accessible filings on its first run; other providers clearly retain incomplete/manual-import coverage. A first run is not a historical backfill or exchange-wide monitoring.

Large original files can be processed with `node scripts/import-local-pdf.mjs manifest.json`; see [the walkthrough](docs/DEMO.md). `npm run test:cache` requires `FINN_CACHE_TEST_URL` pointing at a fresh isolated localhost test database; it never clears existing guidance. All ordinary mutation tests are restricted to localhost.
