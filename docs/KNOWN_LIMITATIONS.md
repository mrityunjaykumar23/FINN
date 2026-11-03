# Current limitations — 3 November 2026

- Source access and completeness vary by issuer. Bounded issuer/exchange/directory discovery is verified on the documented companies, not every NSE company. Four registered dated announcement adapters do not constitute an exchange-wide feed; undated originals require review.
- Oversized annuals, unfamiliar tables, corrupt currency glyphs and scanned PDFs may remain manual/partial. OCR is excluded. The real NSE rendered-HTML adapter is verified; a live raw XBRL/inline-fact provider acceptance remains pending despite context/unit/sign/scale regression tests.
- Financial calculations need compatible actual inputs. Missing periods, annual balances, dates and denominators remain explicit. Industrial measures are not forced onto banks/insurers. Additional prudential ratios are not verified. Labelled revenue/COGS working-capital proxies are not exact reported credit-sales/purchases measures.
- Gemini needs the retained server-side credentials, a working model and quota. Excerpt/number checks do not prove full semantic entailment. Unavailable/rejected responses use labelled deterministic/extractive fallback while verified facts remain available.
- Durable research/snapshot/monitor jobs pause between phases without a polling client or protected worker. Local scheduled phases/cooldowns pass; no hosted recurring schedule was activated. Hosted execution, secrets and persistence need separate deployment verification.
- Multiple actions in one category and similar disclosures in different original documents may need review. Universal semantic event deduplication is not claimed. Mutable URLs can require a controlled explicit re-import.
- Prices are completed EOD observations. Adjusted returns and prior-20-session relative volume stay unavailable when required history is missing. The verified 2026 NSE calendar needs maintenance for future years.
- Anonymous cookies provide per-visitor workspaces, not authenticated multi-device accounts. Phone/browser push, semantic embeddings and advanced visualizations are excluded. No FX conversion or invented missing financial values are provided.

The current results and supported cases are in [FINAL_END_TO_END_AUDIT.md](FINAL_END_TO_END_AUDIT.md). Direct native Gemini research/guidance/risk now pass; earlier failures remain historical audit records. No new production deployment is claimed.
