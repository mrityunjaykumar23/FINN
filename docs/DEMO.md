# Local review walkthrough

This upgrade has not been pushed or deployed. Run `npm run db:migrate:local`, configure ignored `.dev.vars`, then `npm run dev -- --host 127.0.0.1`. Open http://127.0.0.1:5173.

1. **Briefing:** historical replay starts with 18 companies. The 7-day April 2025 window contains Infosys/HCLTech disclosures and real EOD anomalies. Inspect a filing and source page. Date-only windows are labelled calendar days.
2. **Portfolio:** add Asian Paints, reload, then remove it. A separate browser session has independent selections. Removing all companies leaves an empty watchlist after reload.
3. **Alerts:** expand notification history. Mark a notification read/dismissed and revisit the briefing; its state remains. Change volume or price thresholds and evaluate again. Past notifications remain history, while newly qualifying signals respect current rules.
4. **Research:** choose Infosys; ask “What constant-currency revenue growth did Infosys report for FY2025?” with FY2025/results filters. With the real local key, the full pipeline returned accepted Gemini synthesis of 4.2%, with a genuine primary-source quote. Missing credentials produce labelled offline mode.
5. **Unseen ticker:** search LTTS. Primary BSE earnings-call documents were discovered and indexed dynamically, independently of the starter portfolio. A broad revenue/risk question returned Gemini findings and citations. One large annual report remained excluded by the size limit.
6. **Dynamic filing:** run `npm run job:local -- filing docs/examples/dmart-q3.json`, then add DMART and use a custom January 2025 briefing window. Its authentic NSE filing appears. Import `docs/examples/dmart-management.json` for the separately sourced CEO transition on PDF page 4. Repeat import to observe duplicate detection. Extract the existing Q4 document with the provided extraction example, then compare Q4/Q3/prior-year revenue, EBITDA and PAT. PBT remains unavailable.
7. **Guidance:** import both HCL examples in README. The tracker reads SQLite: initial FY2025 guidance 3–5%, revised guidance 4.5–5%, reported CC growth 4.7%. Both statements link to their source and actual; the initial statement is labelled superseded. FY2026 guidance has no actual and refuses scoring.
8. **Durability:** restart the server, then revisit selections, settings, source library, imported filings, guidance and notification state. Research cache hits remain available for identical source/model versions.
9. **Unsupported request:** ask for FY2099 or an unrelated topic; FINN reports insufficient evidence. The system status distinguishes source failures from no filings.

Source examples are authentic links, not simulated disclosures. They require upstream availability. The imported local data and `.dev.vars` are deliberately excluded from Git; commands reproduce ingestion without company-specific source changes or prompts.
