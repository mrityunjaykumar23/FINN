# Gemini and evidence pipeline

## Provider and actual testing

The primary provider is native Google Gemini through `@google/genai` 2.32.0, using `models.generateContent` and JSON-schema constrained responses. The configurable fast model handles classification/extraction and simple synthesis. Optional reasoning routing handles complex research, guidance, cash quality and risks. Real local testing used `gemini-3.5-flash-lite`. `GEMINI_MODEL_REASONING` falls back to the fast model if absent; the local tested configuration uses the same economical model for both.

Official availability, structured output, SDK HTTP options and pricing were checked on 31 October 2026: [models](https://ai.google.dev/gemini-api/docs/models), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [SDK HTTP options](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html). Quotas are project-dependent; FINN does not claim a guaranteed free allowance or fabricate dollar cost telemetry.

A real provider test on Infosys FY2025 evidence passed. The full HTTP pipeline also returned accepted Gemini synthesis for Infosys and newly discovered LTTS. A protected import used Gemini to classify/summarize an authentic HCLTech release and accepted 10 structured metrics plus 2 guidance statements while rejecting 1 unsupported extraction. Unacceptable earlier summaries produced explicit extractive fallback; no failed output was presented as verified Gemini analysis.

## Tasks and validation

`provider.ts` supplies announcement classification/summary/materiality, structured metric and guidance extraction, research analysis, management narrative and bull/bear task interfaces. Shared task execution records model, prompt version, usage, cache and duration. Zod validates every output. Partially malformed extraction arrays can retain individually valid rows; unsupported rows are discarded.

The server prompt confines the model to supplied primary sources and deterministic facts. Documents are untrusted data and cannot grant privileges. No tools, outside company memory or price forecasts are permitted. Credentials are SDK transport headers only, never model context or frontend configuration.

A finding contains claim, source IDs, literal excerpt, evidence type and uncertainty. Checks require existing sources belonging to the requested ticker, a real quoted passage, relevant lexical content, compatible fiscal labels and supported numbers. A source ID alone is insufficient. Calculated findings must reproduce a deterministic supplied calculation. A rejected summary can be replaced only by an independently accepted model finding, with a limitation stating that substitution. The frontend exposes the actual model execution state.

These are conservative automated grounding checks, not a proof that every qualitative inference follows from a passage. Page context and accounting definitions still need investor inspection. AI-extracted facts are labelled source-checked, distinct from reviewed seed facts. Unsupported/missing figures stay unavailable.

## Calculation and storage

Arithmetic belongs to TypeScript: adjusted daily price change, relative volume against prior sessions, QoQ/YoY, cash conversion and guidance variance. Metrics carry period, unit, basis, currency/scale, original page and evidence. Derived quarter comparisons retain both metric references. Guidance matching requires exact ticker/metric/period/unit/basis compatibility; revisions and absent actuals remain visible.

## Budgets and failure behaviour

- At most 90,000 serialized input characters and 5,000 output tokens per provider request.
- 25-second provider timeout; up to 3 attempts only for transient 429/5xx, with exponential backoff and jitter. SDK retries are disabled beyond one attempt.
- Persisted global limits of 30 new AI tasks/hour and 100/day; at most 2 concurrent tasks with expiring SQLite locks. Each task can make at most 3 transport attempts.
- Session and global limits additionally cover research, portfolio validation, market refresh and document discovery.
- Interactive PDFs: 8 MB, 500 pages, permitted HTTPS primary hosts, bounded redirects and request deadlines. No access-control bypass or automatic OCR.
- Source/model/prompt/metric-versioned research cache; separate structured extraction cache, expiring results and shared in-flight task locks.

Missing key/disabled AI, timeout, provider rejection, schema failure, unsupported claims, input limit and rate limit all have explicit states. Deterministic findings and primary excerpts remain available. Provider error bodies, credentials and URLs containing secrets are never logged. `/api/status` exposes safe aggregate usage/configuration, not key values.

## Final evidence and caching changes

Prompt/validation version is `finn-evidence-v4`; retrieval version is `sql-fts-v3`. Company revision counters include indexed chunks, accepted metrics, guidance statements/revisions and deterministic comparison inputs. Model, question and filters also enter the key. Repeated no-op seed annotations and unchanged derivations do not churn the cache after restart. Expired task-cache entries are pruned in bounded batches.

Validation now rejects directional contradictions, unsupported completed/proposed claims and relabelling operating profit as EBITDA. Older unsupported Gemini EBITDA rows are preserved as unverified with an extraction-audit entry. An exact metric value and a valid source ID are insufficient to establish its accounting definition. Ambiguous delimited-table columns are rejected rather than guessed. Task failures expose safe codes including `request_budget` and `timeout`, with deterministic/source fallback.

Actual local provider acceptance includes existing Infosys, HCL forward guidance, annual-report risk analysis and newly discovered Britannia. A real HCL import invalidated a cached research answer, while unrelated Infosys ingestion left it reusable. A rejected broad Britannia synthesis and an exhausted hourly application budget both produced honest fallback; neither was counted as successful Gemini synthesis. See [VERIFICATION.md](VERIFICATION.md).
