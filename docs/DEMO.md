# FINN demo and reproduction guide

**Public demo:** [FINN ENAM Final](https://finn-enam-final-mrity.hazyanole2049.chatgpt.site/). Follow [the reviewer walkthrough](SUBMISSION.md) to review the deployed application without running localhost.

## Reproducible historical evidence on localhost

From the existing project folder, install dependencies once, configure ignored `.dev.vars` with a local `ADMIN_TOKEN` (Gemini is optional for preparation), then run:

```sh
npm run db:migrate:local
npm run dev -- --host 127.0.0.1
```

In another terminal in the same folder:

```sh
npm run demo:prepare
```

Open http://127.0.0.1:5173. Preparation uses the fixed checked-in `data/demo-evidence.json`; it does not depend on undocumented local imports or a working remote source today. It adds six authentic original-source documents, 38 source-checked financial values, two HCL guidance statements and eight source-linked events. Some metrics refer to original seed documents. The source hash, publication date where verified, original URL, page text, extraction method and partial/full coverage remain available. The NTPC rating document deliberately has selected-page coverage. This is historical evidence, not a claim of a successful current monitoring check.

The first visitor retains the original 18-company portfolio. Add DMART through Portfolio/Research to watch it; preparing evidence never modifies an existing watchlist or settings. On Research, compare DMart Q4 FY2025 with Q3 FY2025 and Q4 FY2024; on Promises, inspect HCL's original 3–5% and revised 4.5–5% FY2025 CC growth targets against 4.7% reported. In live mode, use a custom October 2026 window to inspect the authentic dated NTPC capacity filings. A calendar date does not become a fabricated exchange publication time.

Preparation is idempotent, inserts only absent records, retains existing data and requires the protected local admin token. Existing conflicting company/hash associations abort rather than overwrite records. Original anonymous ownership and notification lifecycles remain unchanged.

For verification against a separate empty migrated local database, set `FINN_DEMO_TEST_URL` to its localhost production-preview origin and run `npm run test:demo`. This test refuses a populated source database and never resets it. The final local acceptance ran it successfully from an empty database, prepared twice, preserved 18 companies and verified both quarters, guidance comparisons, dated events and zero fabricated monitoring successes.

## Bounded local jobs

These commands read credentials privately from `.dev.vars`:

```sh
npm run job:local -- discovery --drain
npm run job:local -- ingestion --drain
npm run job:local -- evaluate --drain
npm run job:local -- jobs
npm run job:local -- retry --drain
npm run job:local -- evaluate --resume
```

An optional JSON file after the action can supply `tickers`, `after`, `owner_after`, or a document-job `ticker`, `id` and `limit`. Market refresh is separate: use `market` with a JSON file containing one ticker. Discovery does not import events; ingestion processes already discovered dated candidates without claiming a new source discovery check. Evaluation traverses every owner page. At most 30 calls run per CLI invocation; `.sites-runtime/jobs/` stores checkpoints. `--resume` continues a prior checkpoint; omit it for a fresh scheduled/manual run. Retry jobs respect next-retry dates and stop after three background attempts. There is no cloud scheduler activation.

Original detailed walkthrough (earlier upgrade; manual import examples still supported):

## Additional local walkthrough

For local development, run `npm run db:migrate:local`, configure ignored `.dev.vars`, then `npm run dev -- --host 127.0.0.1`. Open http://127.0.0.1:5173. The public candidate and current verification are linked in [SUBMISSION.md](SUBMISSION.md).

1. **Briefing:** the default is Latest EOD. Select Historical Replay for the 18-company April 2025 example; its 7-day window contains Infosys/HCLTech disclosures and real EOD anomalies. Inspect a filing and source page. Date-only windows are labelled calendar days.
2. **Portfolio:** add Asian Paints, reload, then remove it. A separate browser session has independent selections. Removing all companies leaves an empty watchlist after reload.
3. **Alerts:** expand notification history. Mark a notification read/dismissed and revisit the briefing; its state remains. Change volume or price thresholds and evaluate again. Past notifications remain history, while newly qualifying signals respect current rules.
4. **Research:** choose Infosys; ask “What constant-currency revenue growth did Infosys report for FY2025?” with FY2025/results filters. With the real local key, the full pipeline returned accepted Gemini synthesis of 4.2%, with a genuine primary-source quote. Missing credentials produce labelled offline mode.
5. **Unseen ticker:** search LTTS. Primary BSE earnings-call documents were discovered and indexed dynamically, independently of the starter portfolio. A broad revenue/risk question returned Gemini findings and citations. One large annual report remained excluded by the size limit.
6. **Dynamic filing:** run `npm run job:local -- filing docs/examples/dmart-q3.json`, then add DMART and use a custom January 2025 briefing window. Its authentic NSE filing appears. Import `docs/examples/dmart-management.json` for the separately sourced CEO transition on PDF page 4. Repeat import to observe duplicate detection. Extract the existing Q4 document with the provided extraction example, then compare Q4/Q3/prior-year revenue, EBITDA and PAT. PBT remains unavailable.
7. **Guidance:** import both HCL examples in README. The tracker reads SQLite: initial FY2025 guidance 3–5%, revised guidance 4.5–5%, reported CC growth 4.7%. Both statements link to their source and actual; the initial statement is labelled superseded. FY2026 guidance has no actual and refuses scoring.
8. **Durability:** restart the server, then revisit selections, settings, source library, imported filings, guidance and notification state. Research cache hits remain available for identical source/model versions.
9. **Unsupported request:** ask for FY2099 or an unrelated topic; FINN reports insufficient evidence. The system status distinguishes source failures from no filings.

Source examples are authentic links, not simulated disclosures. They require upstream availability. The imported local data and `.dev.vars` are deliberately excluded from Git; commands reproduce ingestion without company-specific source changes or prompts.

## Final reliability walkthrough

1. Open localhost:5173 and explicitly select Historical Replay for the original 18-company example. Inspect HCL financial evidence, periods, units and source-page links. In a custom 17 April 2025 window, Infosys results and its separate proposed-dividend event share the original PDF page without sharing an event ID.
2. For a new genuine PUSH source, run `npm run job:local -- sync-announcements` with optional input `{ "tickers": ["NTPC.NS"] }`. Select live mode and a custom 29-30 October 2026 window. Inspect NTPC capacity commissioning, priority reasons, primary PDF and stored notification. Source status distinguishes the successful dated table check from unavailable providers.
3. Reproducible protected imports: `docs/examples/ntpc-capacity.json`, `ntpc-acquisition.json`, `ntpc-credit-rating.json`, `ntpc-routine.json`, and `infy-dividend.json`. Use `npm run job:local -- filing <path>`. These are authentic originals with independently checked publication dates; they are not synthetic seed history.
4. Search **Britannia Industries**. Research works without following it. Ask: "For Q1 FY2027, what net sales, operating profit, PBT and PAT growth did management report? Retain the source qualifiers and do not calculate missing values." Choose transcript and Q1 FY2027. Inspect the actual model state and original BSE transcript page 7. Financial snapshots retain separate units/bases; EBITDA is not manufactured from operating profit.
5. Ask HCL's FY2026 guidance question. Forward guidance uses its target year while source metadata retains FY2025. In Promises, inspect original/revised FY2025 targets against the 4.7% actual, both source pages and superseded labels.
6. Refresh sources using the library button. Pending, inaccessible or oversized candidates stay visible in status, rather than becoming a false "no information" conclusion.
7. On mobile, test name search, add/remove (then restore the original portfolio), financial evidence, charts, guidance filter and notification read/unread/dismiss. Preferences survive refresh and restart.

For a legitimately downloaded original PDF, create a local manifest `{ "file":"C:/path/original.pdf", "ticker":"NTPC.NS", "url":"https://ntpc.co.in/sites/default/files/announcement/2026/2026-02/20260217_STEX_CREDITRATING.pdf", "title":"Original disclosure", "type":"announcement" }`, substituting the real original URL, then run `node scripts/import-local-pdf.mjs manifest.json`. The file is hashed, extracted locally and uploaded in authenticated small batches. Re-running resumes idempotently. Scanned pages remain partial; OCR is not claimed. Credentials are read privately from existing `.dev.vars`.

The long-document/pagination regressions use explicitly labelled isolated fixtures, not fictional data in the investor application. `npm run test:cache` must target a **fresh isolated localhost test database** through `FINN_CACHE_TEST_URL`; it refuses to clear an existing guidance library.

For portfolios/owners larger than one batch, finish each company batch's owner evaluation before advancing companies: retain `next_company_cursor`, drain `alerts.next_owner_cursor` using `tickers: []` plus `owner_after`, then run the next company batch with `after` and a reset owner cursor. This keeps earlier owners eligible for filings found in later company batches. Scheduling is deferred; an eventual scheduler must consume these continuations.

## Integration checks

The core `npm test`, type checks, lint and production build run without a server. HTTP suites need a running localhost Worker, normally `npm start -- --port 5173` after building. Configure `FINN_TEST_URL` for API/job suites using another local port; some older opt-in scripts use port 5173 directly.

The current-alert API checks require real recent observations or announcements. Historical demo preparation alone does not create live alerts: populate current market/source data through the local UI or protected ingestion first. Test identities separate ordinary HTTP fixtures from the browser watchlist.

- `test:gemini` requires a valid provider key/model/quota and skips explicitly when unconfigured.
- `test:cache` requires `FINN_CACHE_TEST_URL` pointing at a fresh isolated localhost database.
- `test:demo` requires `FINN_DEMO_TEST_URL` pointing at a fresh isolated localhost database; it refuses a populated fixture and never resets one.
- `test:research-contention` requires `FINN_TEST_URL` and an actual `FINN_TEST_DB` file inside this checkout's `.sites-runtime/`. It holds/releases a source lease, verifies latest and explicit-period requests, and preserves all 60 fixture candidates across D1 batch boundaries.

For the contention fixture, first complete the normal local migration setup so `.sites-runtime/local-migrations.json` exists, then use an isolated persistence directory:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config .sites-runtime/local-migrations.json --persist-to .sites-runtime/contention-test
npm start -- --port 5188 --persist-to .sites-runtime/contention-test
```

In a separate PowerShell terminal:

```powershell
$env:FINN_TEST_URL = 'http://127.0.0.1:5188'
$env:FINN_TEST_DB = (Get-ChildItem .sites-runtime/contention-test/v3/d1/miniflare-D1DatabaseObject -Filter '*.sqlite' | Where-Object Name -ne 'metadata.sqlite' | Select-Object -First 1).FullName
npm run test:research-contention
```

Stop the owned fixture server afterward. Preserve existing environment files and working databases. Provider failures, fallback answers and skipped credentialed tests must not be reported as successful real Gemini acceptance. The [submission evidence](test-results/submission/README.md) records the checks that actually ran.
