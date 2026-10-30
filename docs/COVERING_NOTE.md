Subject: ENAM - IIT screening - 2027

Dear ENAM team,

I built FINN as a compact investment desk around one loop: discover a signal, understand why it matters, inspect the original evidence, and investigate further.

The prototype includes an 18-company portfolio, a windowed and ranked briefing, configurable EOD price/volume triggers, primary-source research on companies outside the portfolio, and a management guidance tracker. The signature example compares Infosys's revised FY2025 guidance with its reported outcome, using matching constant-currency definitions and links to both primary documents.

The demo works without AI credentials. It uses authentic cached company documents and historical price observations, deterministic financial calculations, and an optional server-side model adapter. Research on uncached NSE tickers attempts validation, document discovery, PDF extraction and indexing. I verified that path using COFORGE.NS as well as the cached examples.

I chose a same-origin React/TypeScript Worker backend and persistent SQLite to keep the deployed demonstration self-contained, with Python for ingestion and independent calculation validation. I deliberately left out phone notifications, trading, elaborate authentication, a separate vector service, and any claim of comprehensive real-time exchange coverage. The curated historical briefing covers two companies, and that limitation is visible in the product.

Next I would widen approved source coverage, add scheduled ingestion and queued PDF processing, improve semantic retrieval and citation-entailment checks, and extend the guidance tracker with verified comparable periods for more companies.

Demo: [FINN](https://finn-investment-intelligence-mrity.hazyanole2049.chatgpt.site)

Repository: GitHub publication requires the account connection; use the final repository URL once published.

AI build history: `docs/development/CONVERSATION.md` contains actual user/assistant messages from the development chat. It is an honest partial export, not a fabricated reconstruction. Keep the complete chat export/share link with the submission.

The deployed demo is public and opens without sign-in. This file is a draft and has not been emailed.

Regards,
[Your name]
