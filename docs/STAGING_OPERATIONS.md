# FINN isolated staging operations

The existing public Site identity is preserved in `.openai/production-hosting.json`. The current staging branch points `.openai/hosting.json` to a distinct owner-private Site. Both use the same Worker/D1 architecture and application source. Publishing staging must not deploy to the public production project. Production promotion requires the user's approval and restoration of its hosting identity; configure its own encrypted service credential before enabling production schedules.

## Runtime secrets and initial data

Configure server-side `GEMINI_API_KEY`, `AI_ENABLED`, `GEMINI_MODEL_FAST`, optional `GEMINI_MODEL_REASONING`, and `ADMIN_TOKEN` through Sites encrypted environment variables. `.dev.vars`, local databases and credentials must remain untracked and outside archives. Sites applies tracked D1 migrations before Worker publication. Migration 0008 only adds nullable document-job extraction status/result columns. Existing source/publication metadata and earlier completion states are repaired without deleting original documents, metrics, alerts or visitor preferences.

After the first health request initializes the original seed, call protected `POST /api/admin/prepare-demo` with the server-side administrator credential. Run it twice and compare `/api/status` counts. Expect 17 bundled documents, the original 18-company starter portfolio, authentic financial metrics, HCL original/revised guidance and source-linked announcements. Preparation must not fabricate successful monitoring checks. No personal local database is uploaded.

## Bounded unattended writer

`POST /api/jobs/scheduled` accepts one bounded step: `phase` is `market`, `discovery`, `ingestion`, `evaluate` or `documents`; optional `after` and `owner_after` are continuation cursors. Market handles 3 companies, discovery/ingestion use only registered announcement sources, evaluation handles 30 owners, and document processing handles one queued original. Follow `next_company_cursor` or `next_owner_cursor` in `result` until absent. Stop after 30 requests per run; retain source/owner progress for a later run when needed. Failed sources remain visible and do not imply zero activity.

The writer always requires application authorization. Existing `ADMIN_TOKEN` requests remain supported. For unattended work, the Site's supported service-access value is configured as encrypted `SITES_SCHEDULED_TOKEN`; each scheduled request also sends `X-Finn-Job-Authorization: Bearer <token>`. Sites service access is obtained from that Site's `get_site` response and sent only to that exact Site, in `OAI-Sites-Authorization` for its platform gate and in the job-specific header for the bounded writer. The platform header alone does not authorize application writes. Never put credential values in task prompts, files, logs or source. Public production uses its own Site-scoped encrypted binding after promotion approval. A missing or stale binding must fail closed rather than run unauthenticated.

Schedule market updates after the completed NSE session and provider buffer; announcements may be checked independently during business days. Provider data and source access still determine freshness. Verify one update through the intended service access and read back status/DB data before enabling a schedule. Schedule creation proves saved timing, not a completed future cloud run.

## Four corrected audit findings

- Date-only publication values are labelled date-only; a real company-recorded timestamp is distinguished from an exchange broadcast time. Original calendar dates and raw timestamps remain intact.
- PDF indexing and financial extraction have separate durable state. Provider failures return `extraction_failed`, retain document IDs, and retry without redownloading the original; exhausted/unsupported financial extraction requires manual review. A job is complete only after its applicable extraction succeeds.
- Independent announcement candidates continue after an individual failed source, while retaining per-candidate attempts, next retry and errors.
- Saving preferences writes settings only. Historical replay and alert evaluation require opening the corresponding briefing or an explicit evaluation action; read/dismissed notification states remain durable.

## Verification boundary

Run the complete unit, API, ingestion, Gemini, cache, fresh-demo, financial-validation, type, lint and production-build suites. Verify live PUSH, unfamiliar-company PULL with real Gemini and primary citations, independent visitor portfolios/preferences, mobile/desktop layout and hosted database persistence. Read Sites D1 overview before inspecting deployed rows. Existing public production must remain unchanged until the user approves replacement.
