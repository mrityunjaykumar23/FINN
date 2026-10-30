# MASTER BUILD PROMPT — FINN: AI Investment Intelligence Copilot

## 1. YOUR ROLE

You are a senior full-stack AI engineer, financial-data systems architect, and exceptional mobile product designer.

Your task is to build a complete, working, deployable prototype called **FINN — Financial Investment Agent**, for the ENAM Holdings AI Engineer Build Challenge.

Build this as a serious product for public-market investors, not as a hackathon template, generic chatbot, or ordinary stock-tracking dashboard.

Prioritise:
1. Genuine end-to-end functionality.
2. Clear investor value.
3. Reliable primary-source-grounded AI reasoning.
4. Exceptional mobile-first interface design.
5. Intelligent prioritisation of noisy financial events.
6. Robust generalisation beyond a fixed list of companies.
7. Efficient AI and data-processing architecture.
8. Readable, modular, maintainable code.
9. Fast performance and graceful error handling.
10. A convincing, testable deployed demonstration.

**The core product philosophy: An investor should open FINN and understand in 30 seconds what changed, why it matters, and what deserves further investigation.**

Do not sacrifice working functionality for decorative features.

## 2. ASSIGNMENT CONTEXT

The challenge requires an AI-powered financial investment agent for Indian public-market investors.

The product must support two interaction modes:

**PUSH:** FINN proactively identifies important developments across an investor's portfolio.

**PULL:** FINN performs on-demand research about any supported NSE-listed company using primary company documents.

Use a mock portfolio of 15–20 NSE/BSE-listed companies representing diverse industries and company sizes.

Additionally, demonstrate on-demand company research on 3–5 companies that may not be in the portfolio.

The research engine MUST NOT be hardcoded to these companies. It must accept an arbitrary NSE ticker and attempt to retrieve and analyse the company's available information.

The result must be a mobile-first working prototype, with a deployed interface, GitHub repository, transparent AI development history, and concise documentation of decisions and trade-offs.

The assignment explicitly values focused execution over feature count.

## 3. PRODUCT DIFFERENTIATION

Most financial products display large quantities of information and leave the investor to identify what matters.

FINN should do the opposite.

It should:
- Reduce hundreds of raw updates into a prioritised briefing.
- Distinguish material events from routine compliance filings.
- Explain why a company announcement deserves attention.
- Reveal supporting evidence behind every important claim.
- Detect unusual price and volume behaviour using configurable rules.
- Compare management statements with actual reported numbers.
- Provide on-demand fundamental research without relying on secondary commentary.
- Make it easy to move from a short insight to detailed evidence.

Create a consistent interaction loop:

**Discover signal → Understand impact → Inspect evidence → Investigate further**

This is the signature experience of FINN.

## 4. TECHNOLOGY STACK

Use the following preferred stack, unless a simpler alternative is necessary for reliability.

Frontend:
- Next.js with App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or equivalent accessible components
- Lucide icons
- Recharts for financial charts
- Responsive, mobile-first CSS

Backend:
- Python
- FastAPI
- Pydantic for API validation
- pandas and NumPy for financial calculations
- yfinance for daily market data
- httpx or requests for approved data retrieval
- PyMuPDF for PDF processing
- BeautifulSoup when appropriate for publicly accessible pages

AI:
- A configurable LLM provider through an abstraction layer.
- Use an affordable capable model for text extraction, classification, and summaries.
- Use a stronger reasoning model only for complex analysis when justified.
- Support mock/offline mode without API credentials.
- Never expose API keys to the browser.

Retrieval:
- Use lightweight embeddings or a retrieval library when useful.
- Prefer a simple persistent document index.
- For a small demo, SQLite with a full-text search index may be sufficient.
- Only introduce a separate vector database if it demonstrably improves retrieval.

Database:
- SQLite for the initial prototype.
- SQLAlchemy for schema management.
- Store source metadata, announcements, historical prices, portfolios, alert configurations, document chunks, and cached AI outputs.

Deployment:
- Frontend on Vercel or another practical host.
- Backend on an appropriate Python hosting service.
- Persistent database or managed storage appropriate to the chosen host.
- Clear environment-variable configuration.
- Provide a working mobile-accessible URL.

Avoid unnecessary infrastructure, microservices, paid services, or complex authentication.

## 5. USER EXPERIENCE AND DESIGN

Create an elegant, professional, high-information-density interface.

The visual identity should be closer to a premium financial intelligence terminal adapted for mobile than a generic SaaS dashboard.

Design language:
- Deep navy or charcoal surfaces.
- Warm off-white text.
- Restrained teal/green accents for positive or verified information.
- Muted amber for caution.
- Red for material negative developments.
- Excellent typography.
- Generous but purposeful spacing.
- Crisp chart labels.
- Clear source attribution.
- Meaningful icons only.
- No decorative gradients that compromise readability.
- No unnecessary animations.
- No oversized cards containing little useful information.

Every interaction should feel intentional.

Use progressive disclosure:
- Show concise insights first.
- Reveal details on demand.
- Let the investor inspect original evidence without overwhelming the briefing screen.

Design and implement these main views:

### Screen A — Today / Intelligence Briefing

This is the default landing screen.

Show:
- FINN brand and compact header.
- Selected portfolio.
- Active briefing window, defaulting to the past 24 hours.
- Optional 7-day and custom time-window selection.
- Number of important events.
- Number of unusual market movements.
- A ranked timeline of relevant announcements.
- Short AI summaries.
- Concise why-it-matters explanations.
- Event priority and event type.
- Source links.
- Easy access to deeper research.
- Collapsible section for routine low-priority filings.

The feed should communicate both what FINN surfaced and what it deliberately deprioritised.

Do not invent announcements to fill empty states.

If nothing relevant occurred, show a useful empty state, such as:

"No material portfolio developments found in this window."

Allow users to inspect all filings if they wish.

### Screen B — Event Detail / Evidence

When an investor opens an important alert, display:

- Company name and ticker.
- Event headline.
- Publication timestamp.
- Classification.
- Priority.
- Concise factual summary.
- Why it could matter.
- Source filing.
- Relevant extracted evidence.
- Key numerical metrics, if available.
- Further research questions.

For quarterly results, provide:
- Revenue.
- EBITDA.
- PBT.
- PAT.
- Current quarter.
- Previous quarter.
- Same quarter a year earlier.
- QoQ changes.
- YoY changes.

Every extracted number must be traceable to a source.

If data is unavailable, explicitly display "Not reported" or "Unavailable".

### Screen C — Portfolio

Display an example 15–20 company watchlist.

Start with a diverse, configurable selection such as:

RELIANCE.NS
TCS.NS
INFY.NS
HCLTECH.NS
HDFCBANK.NS
ICICIBANK.NS
SBIN.NS
ONGC.NS
NTPC.NS
MARUTI.NS
M&M.NS
ITC.NS
HINDUNILVR.NS
SUNPHARMA.NS
DRREDDY.NS
BHARTIARTL.NS
LT.NS
TITAN.NS

Validate these symbols using the data provider rather than assuming every symbol is currently valid.

For each company, show:
- Name and ticker.
- Latest available daily closing price.
- Daily percentage change.
- Relative trading volume when computable.
- Number of meaningful recent events.
- Last data update time.

Implement:
- Add company.
- Remove company.
- Search company.
- Persist portfolio selection.
- Open company research.
- Manage company-specific alert settings.

Important distinction:

Portfolio monitoring is not company research.

A company does NOT need to belong to the portfolio to be researched.

The initial portfolio is only a demo configuration, not a training dataset.

### Screen D — AI Research Copilot

Provide ticker-based company research.

Allow the user to enter any supported NSE ticker, such as:
- TCS.NS
- RELIANCE.NS
- ASIANPAINT.NS

Validate and resolve the ticker.

If the company is not cached:
- Fetch available primary company documents.
- Extract and index document content.
- Retrieve relevant passages.
- Generate grounded analysis.

If documents cannot be retrieved, clearly explain the limitation instead of returning fabricated content.

Display:
- Company overview.
- Business segments.
- Revenue breakdown, when available.
- Financial snapshot.
- Multi-year growth trends.
- Profitability trends.
- Debt and leverage.
- Cash-flow quality.
- Management guidance.
- Bull versus bear perspectives.
- Source references.

Do not require the user to navigate eight separate screens.

Use a concise initial summary with expandable research sections and contextual suggested questions.

Provide an AI question box with examples:

"How has revenue growth changed?"

"Does cash flow support reported profitability?"

"What did management guide for future margins?"

"What were the major risks mentioned in the annual report?"

"Did management deliver on its previous guidance?"

Answers must be generated from retrieved source material and appropriate calculations, not model memory.

### Screen E — Alert Settings

Allow users to configure:
- Daily absolute percentage price-move threshold.
- Relative volume threshold.
- Recent-average volume lookback, default 20 trading sessions.
- Preferred corporate-announcement categories.
- Minimum priority for surfaced alerts.
- Optional company-specific rules.

The prototype should reliably generate in-app alerts from stored or newly ingested data.

Actual phone push notifications are optional and should not be prioritised over the core experience.

Clearly distinguish end-of-day alerts from real-time market alerts.

## 6. DATA SOURCES

Implement three source pipelines.

### Source 1: Price and volume

Use yfinance or another accessible public provider.

Indian stock symbols commonly use:
- .NS for NSE
- .BO for BSE

Retrieve:
- Daily close.
- Historical daily price.
- Daily trading volume.
- Dates and source metadata.

Use adjusted/consistent price series for comparisons where corporate actions would otherwise distort returns.

Maintain data freshness timestamps.

Calculate:
- Daily price movement.
- Rolling average volume.
- Relative volume.
- Relevant historical price and financial trends.

Never present daily closing prices as intraday live prices.

### Source 2: Corporate announcements

Retrieve publicly accessible NSE/BSE corporate announcements and filings.

Implement a source adapter rather than hardcoding a particular HTML layout throughout the application.

Respect access restrictions, robots policies, rate limits, and permitted usage.

If direct exchange access is unreliable:
- Do not attempt unsafe circumvention.
- Build an import adapter for authentic downloaded exchange filings.
- Maintain a small, verified snapshot dataset for the demo.
- Clearly label imported historical data and its source.

Required metadata:
- Company.
- Ticker.
- Headline.
- Published timestamp.
- Original source.
- Document URL or stored source-file reference.
- Announcement body or extracted text.
- Category.
- Materiality priority.
- Summary and supporting evidence.

Implement duplicate detection.

### Source 3: Company fundamentals

Use annual reports and earnings-call transcripts available through public links on screener.in and official investor-relations websites.

For Pull research, these are the authoritative sources.

Also use official quarterly company disclosures and investor presentations where relevant to calculations and management commentary.

Do not use:
- Broker research.
- Financial-news analysis.
- Third-party investment opinions.
- Unverified internet summaries.
- The LLM's learned knowledge as factual evidence about company-specific performance.

Primary company sources must support the research outputs.

Store:
- Document title.
- Company.
- Financial period.
- Document type.
- Publication date when known.
- Source URL.
- Extracted text.
- Page numbers.
- Chunk metadata.
- Content hash.
- Retrieval timestamp.

## 7. CORPORATE ANNOUNCEMENT CLASSIFICATION

Implement the reference document's announcement taxonomy.

Supported categories:

1. results — quarterly and annual financial disclosures.
2. M&A — mergers, acquisitions, demergers, joint ventures.
3. fund_raise — equity or debt fundraising and related capital actions.
4. management_change — CEO, CFO, MD, or director appointments, departures, and resignations.
5. litigation — lawsuits, fines, regulatory actions, insolvency proceedings.
6. insider_trading — promoter or insider share transactions.
7. earnings_call — calls, notices, recordings, transcripts.
8. investor_meetings — investor meetings or conferences.
9. credit_rating — credit-rating upgrades, downgrades, reaffirmations.
10. dividend — dividends and related record dates.
11. bonus_split — bonus shares and stock splits.
12. capex — new plants, facilities, capacity expansion.
13. press_release — material general announcements, orders, products, partnerships.
14. postal_ballot — shareholder voting by postal ballot.
15. agm_egm — annual and extraordinary general meetings.
16. pledging — changes in promoter share pledging.
17. unclassified — routine and miscellaneous disclosures.

Use the categories as a starting point, not a rigid substitute for understanding.

Classify each announcement using:
- Deterministic keyword/rule-based classification where reliable.
- LLM-assisted classification for ambiguous cases.
- Structured model output.
- Source-backed rationale.
- Confidence or uncertainty tracking.

Do not automatically assume all announcements of a given category are important.

For example:
- A routine investor-meeting intimation may be low importance.
- A CEO resignation may be highly important.
- A small acquisition may be low importance.
- An unusually large acquisition may be highly important.

Materiality depends on content, magnitude, and relevance, not just category.

## 8. SIGNAL PRIORITISATION ENGINE

Build a transparent importance-ranking mechanism.

Use a combination of:

A. Event category and severity.

B. Numerical magnitude, if supported by the source.

C. Novelty relative to recent filings.

D. Investor-defined preferences.

E. Data confidence and source quality.

F. Potential effect on the company's business or financial condition.

A simple initial scoring design may be used:

- Event-severity score: 0–40.
- Material numerical impact: 0–25.
- Relevance to preferences: 0–15.
- Novelty: 0–10.
- Evidence confidence: 0–10.

Total: 0–100.

These weights are a recommended implementation choice, not something mandated by ENAM.

Ensure the scoring function is configurable, testable, and interpretable.

Suggested priority:
- 75–100: Critical.
- 50–74: Important.
- 25–49: Watch.
- 0–24: Routine.

Do not confuse the score with predicted future share-price performance.

The product should be able to explain:

"This is ranked highly because the company disclosed a significant change in top management."

Avoid speculative statements like:

"This announcement will cause the share price to increase."

When information is insufficient, clearly say why further investigation is required.

## 9. FINANCIAL METRICS AND CALCULATIONS

Implement accurate financial computations.

The companion glossary defines:

Revenue: Total company sales.

EBITDA: Earnings before interest, tax, depreciation and amortisation.

PBT: Profit before tax.

PAT: Profit after tax.

Margins: Profitability metrics expressed as a share of revenue.

QoQ: Current quarter versus immediately previous quarter.

YoY: Current quarter versus the corresponding quarter in the previous year.

Debt-to-equity: Total debt divided by shareholders' equity.

Free cash flow: Operating cash flow minus capital expenditure.

Other relevant measures include:
- ROE.
- ROCE.
- Cash conversion.
- Working-capital cycle.
- Debt and leverage.
- Financial guidance.
- Cash generation.

For quarterly comparisons:

QoQ Growth (%) =
(Current Quarter Value - Previous Quarter Value)
÷ Previous Quarter Value × 100.

YoY Growth (%) =
(Current Quarter Value - Same Quarter Last Year Value)
÷ Same Quarter Last Year Value × 100.

For negative or zero comparison bases, handle ratios explicitly rather than blindly applying the formula.

For margin:

EBITDA Margin (%) =
EBITDA ÷ Revenue × 100.

For price movement:

Daily Price Change (%) =
(Current Close - Previous Close)
÷ Previous Close × 100.

For volume:

Relative Volume =
Current Session Volume
÷ Average Volume of Previous N Sessions.

Use prior sessions for the volume baseline so today's volume is not included in its own comparison.

Financial extraction rules:
- Preserve units and currencies.
- Distinguish consolidated versus standalone statements.
- Distinguish quarters from fiscal years.
- Distinguish reported numbers from calculated numbers.
- Never silently merge different accounting bases.
- Do not approximate unavailable EBITDA or other metrics without a defensible formula and disclosures.
- Respect fiscal year and quarter labels.
- Identify restated numbers where relevant.
- Track source and reporting period for every metric.
- Do not manufacture values to complete a chart.

Use Python for calculations and deterministic validation.

Use the LLM for explanation, comparison, extraction assistance, and qualitative reasoning.

## 10. THE SIGNATURE FEATURE: MANAGEMENT PROMISE TRACKER

This should be FINN's standout AI capability.

Build a focused feature that compares what company management said with what subsequent reported results show.

Workflow:

1. Retrieve earnings-call transcripts from relevant historical quarters.
2. Identify statements representing explicit management guidance.
3. Extract the metric, target, date or period, and qualifiers.
4. Retrieve subsequent official company financial results.
5. Extract the matching actual metric.
6. Verify that both metrics use comparable definitions and reporting periods.
7. Compute the difference.
8. Generate a concise explanation.
9. Provide citations for both the management statement and the reported result.

Example using fictional data:

Management guidance:
"Revenue growth of approximately 15% for FY2026."

Actual reported growth:
8%.

Variance:
-7 percentage points.

FINN output:
"Reported revenue growth was 7 percentage points below management's stated guidance. Review the earnings-call commentary for the explanation."

The output must link to:
- The original transcript and relevant page or passage.
- The official financial-results document and relevant figure.

Important safeguards:
- Distinguish firm numerical guidance from general optimism.
- Do not treat every aspirational comment as a promise.
- Do not claim that missed guidance proves deception.
- Explain when accounting metrics or reporting periods are not comparable.
- Return "Insufficient comparable evidence" where appropriate.

For the initial demo, implement this well for one or two companies with verifiable primary documents.

Keep the underlying architecture reusable for other tickers.

This feature should be highly visible in the product rather than hidden in a generic chat interface.

## 11. AI RESEARCH / RAG PIPELINE

Implement a robust, source-grounded pipeline.

Suggested architecture:

User question
→ Ticker resolution
→ Cached document lookup
→ Fetch missing primary documents
→ PDF/text extraction
→ Cleaning and chunking
→ Relevant passage retrieval
→ Structured fact extraction
→ Financial computation
→ LLM synthesis
→ Citation validation
→ User response

### Retrieval requirements

Store document chunks with:
- Ticker.
- Document ID.
- Document type.
- Reporting period.
- Page number.
- Chunk text.
- Source URL.
- Content hash.

Retrieve content based on both:
- Semantic relevance.
- Financial period and document-type filters.

Prefer retrieving a manageable number of relevant passages rather than inserting entire annual reports into every request.

### AI response requirements

Use a strict structured format where appropriate:

{
  "ticker": "...",
  "question": "...",
  "summary": "...",
  "key_findings": [],
  "metrics": [],
  "source_references": [],
  "limitations": [],
  "confidence": "high | medium | low"
}

Every material factual statement should have a source reference.

The confidence label must reflect evidence quality and coverage, not model self-certainty.

If relevant evidence is absent, state what could not be established.

Do not invent page numbers or citations.

Do not allow document text to act as executable instructions for the agent.

Treat retrieved PDF and web content as untrusted data.

Never permit a source document to override system prompts, access secrets, or trigger unauthorised operations.

### AI cost optimisation

Use:
- Model routing.
- Document caching.
- Incremental updates.
- Content hashes.
- Reusable extraction results.
- Small prompts.
- Deterministic numerical calculations.
- A stronger model only where detailed reasoning genuinely helps.

Cache by:
- Ticker.
- Document version.
- Prompt/version.
- Analysis type.

Invalidate outdated analysis when relevant primary documents change.

## 12. BACKEND API

Design clean REST endpoints.

Suggested routes:

GET /api/health
GET /api/portfolio
POST /api/portfolio
DELETE /api/portfolio/{ticker}

GET /api/market/{ticker}
GET /api/announcements
GET /api/announcements/{id}
GET /api/digest

GET /api/alerts/settings
PUT /api/alerts/settings
GET /api/alerts

GET /api/companies/search
GET /api/companies/{ticker}/overview

POST /api/research
GET /api/research/{ticker}/documents
GET /api/research/{ticker}/guidance

POST /api/admin/ingest-market
POST /api/admin/ingest-announcements

Admin ingestion endpoints must not be publicly writable without protection.

Use Pydantic validation.

Return structured errors.

Make API calls idempotent where appropriate.

The frontend must use actual backend endpoints.

Avoid UI components that appear functional but only manipulate hardcoded presentation data.

## 13. DATABASE DESIGN

Use normalised tables or equivalent models.

Suggested entities:

companies
- id
- ticker
- company_name
- exchange
- sector

portfolio_companies
- company_id
- created_at

daily_prices
- company_id
- trading_date
- open
- high
- low
- close
- volume
- source
- retrieved_at

announcements
- id
- company_id
- headline
- category
- published_at
- source_url
- document_reference
- content_hash
- priority_score
- summary
- analysis_status

documents
- id
- company_id
- document_type
- fiscal_period
- published_at
- source_url
- stored_path
- content_hash

document_chunks
- id
- document_id
- page_number
- text
- retrieval_metadata

financial_metrics
- company_id
- reporting_period
- metric_name
- metric_value
- unit
- accounting_basis
- source_document_id
- source_page

guidance_statements
- company_id
- source_document_id
- target_period
- metric
- guidance_value
- guidance_text
- qualifiers
- source_location

alerts
- id
- company_id
- rule_type
- event_reference
- triggered_at
- status

alert_preferences
- price_threshold
- volume_multiplier
- volume_lookback
- enabled_categories

Do not over-engineer data modelling if a simpler schema achieves the same reliable result.

## 14. ROBUST DEMO DATA STRATEGY

Reliability is essential.

Use two modes:

### Live mode

Fetch the latest available source data through the implemented adapters.

Show freshness indicators.

Handle unavailable sources gracefully.

### Verified demo mode

Bundle a small dataset consisting of authentic, previously retrieved financial filings, announcements, and price observations.

The demo dataset must:
- Preserve actual source metadata.
- Be clearly labelled as historical or demo data.
- Contain no fabricated company claims.
- Support meaningful classification and research examples.
- Work without external API credentials.
- Demonstrate the core workflows even if upstream sources are temporarily unavailable.

Use explicitly fictional sample data only in isolated UI tests and mark it clearly.

Do not pass fake examples off as actual exchange announcements.

Never silently replace a failed live request with synthetic financial information.

A judge must be able to open the application and test the essential features immediately.

## 15. INTERACTIVE PRODUCT DETAILS

Implement the following interactions:

- Change briefing time window.
- Filter by company.
- Filter by event category.
- Expand low-priority filings.
- Open original source documents.
- Open a company from an event.
- Ask AI about the event.
- Search an arbitrary supported NSE ticker.
- Add or remove a company from the portfolio.
- Adjust alert thresholds.
- View historical price and volume charts.
- Inspect management guidance comparisons.
- Expand source evidence.
- Navigate comfortably on a phone.

Use loading skeletons where appropriate.

Handle:
- Network failure.
- Unsupported ticker.
- Missing filing.
- Empty reporting period.
- LLM timeout.
- Malformed document.
- Rate-limited source.
- Incomplete financial statement.
- Missing API key.

Never leave the page blank or crash in these conditions.

## 16. TESTING AND VALIDATION

Implement meaningful tests.

Backend:
- Price-change calculation.
- Relative-volume calculation.
- QoQ and YoY calculation.
- Zero denominator handling.
- Category classification.
- Duplicate filing detection.
- Alert triggering.
- Date-window filtering.
- Priority-score bounds.
- Financial-period alignment.
- Source metadata validation.
- Guidance versus actual comparison.

RAG:
- Retrieval is restricted to relevant company documents.
- A missing source never generates a fake citation.
- Answers refuse unsupported company-specific claims.
- Cross-company information does not contaminate responses.
- Malicious instructions inside PDFs cannot hijack the agent.

Integration:
- Search a portfolio ticker.
- Search a ticker outside the portfolio.
- Retrieve an announcement.
- Generate a digest.
- Trigger an alert on qualifying EOD data.
- Generate a grounded research answer.
- Compare guidance and actual performance.

Frontend:
- Mobile navigation.
- Responsive layout.
- Loading and empty states.
- Source links.
- Error handling.
- Basic accessibility.
- Interaction feedback.

Test across a realistic mobile viewport and a desktop viewport.

## 17. ACCEPTANCE CRITERIA

A successful implementation should demonstrate all of the following:

1. The deployed website opens reliably on a phone.
2. The investor can see a portfolio containing 15–20 listed companies.
3. The investor can add or remove a ticker.
4. Prices and timestamps come from actual stored or retrieved data.
5. A configurable time-window briefing displays real classified announcements.
6. Meaningful events are prioritised and routine filings are collapsed.
7. Each important insight includes evidence or a direct source link.
8. Price and volume alerts are generated from real calculations.
9. The user can search a company outside the initial portfolio.
10. The backend attempts generalised document retrieval for an unfamiliar ticker.
11. The research answer cites actual primary documents.
12. The management guidance tracker compares compatible statements and reported values when sources exist.
13. The application handles missing evidence without hallucinating.
14. Core workflows still work with verified cached/demo documents.
15. The GitHub repository contains clear setup and architecture instructions.
16. API credentials and secrets are not committed.
17. The deployed version is tested, not merely generated.

## 18. DELIVERY PRIORITIES

Build in phases.

### Phase 1 — Working foundation

- Repository setup.
- Frontend and backend.
- Database.
- Portfolio.
- Market-data pipeline.
- Company search.
- Core mobile layout.

This must run before adding complex AI features.

### Phase 2 — Push workflow

- Announcement ingestion.
- Classification.
- Importance ranking.
- Windowed digest.
- Source links.
- Configurable EOD alerts.

### Phase 3 — Pull workflow

- Company-document retrieval.
- PDF extraction.
- Passage indexing.
- Research questions.
- Source-grounded AI responses.
- Financial snapshots.

### Phase 4 — Differentiating insight

- Management guidance extraction.
- Comparison against reported performance.
- Evidence-linked explanation.

### Phase 5 — Quality and deployment

- Mobile polish.
- Real tests.
- Failure handling.
- Caching.
- Deployment.
- README.
- Architecture documentation.
- Demo walkthrough.

If time is constrained, cut breadth rather than sacrificing the quality of the essential workflows.

## 19. REQUIRED REPOSITORY DOCUMENTATION

Create a clear README that includes:

- What FINN is.
- The investor problem it solves.
- Product screenshots.
- Live demo link.
- Core workflows.
- Architecture diagram.
- Tech stack.
- Setup commands.
- Environment variables.
- Data sources and restrictions.
- AI model usage.
- Prompt and retrieval strategy.
- Calculation methodology.
- Caching and cost optimisations.
- Testing instructions.
- Design decisions.
- Limitations.
- Planned improvements.

Include an example .env file without credentials.

Create a short architecture document explaining:
- Data ingestion.
- Classification and ranking.
- Alert evaluation.
- RAG retrieval.
- Source attribution.
- Financial calculations.
- Frontend/backend separation.

The real AI coding-agent conversations must be preserved for the assignment submission.

Do not generate fictional AI development history.

## 20. DEVELOPMENT INSTRUCTIONS

Do not simply describe an implementation.

Actually create the project, files, API routes, components, database models, ingestion scripts, AI services, tests, and documentation.

Work incrementally.

At each phase:
1. Implement the functionality.
2. Run it.
3. Test the happy path.
4. Test an error case.
5. Fix failures.
6. Move to the next phase.

Keep the solution coherent and maintainable.

Make sensible implementation decisions without repeatedly asking for clarification.

Before using a specific library or external endpoint, verify its availability and API expectations.

Never claim an external integration works unless it has actually been tested.

Use honest fallbacks when external services are inaccessible.

Do not create fake market data, fake research citations, or fabricated investment conclusions.

Do not add decorative buttons or screens with no functionality.

Avoid building a generic ChatGPT clone.

Build an opinionated investor workflow in which AI intelligence is embedded into the feed, the research interface, and the evidence trail.

## 21. FINAL PRODUCT QUALITY BAR

The application should feel like a compact, credible financial research product.

A judge should be able to perform this sequence:

1. Open FINN on mobile.
2. See a concise briefing of important company developments.
3. Open one priority event.
4. Understand what happened and why it was surfaced.
5. Inspect the underlying filing.
6. Ask FINN a question about the affected company.
7. Read a grounded answer with citations.
8. Search a completely different NSE ticker.
9. Successfully initiate on-demand analysis.
10. Change an alert threshold.
11. Understand that the product could scale beyond its demo company list.

**The success criterion is not the number of screens or LLM calls. It is the amount of useful, trustworthy investor intelligence delivered with minimal effort.**

Begin with a concise architecture and development plan, then start implementing Phase 1 immediately. Continue through the phases while keeping the application runnable and documenting genuine limitations.
