# Public submission verification evidence

Recorded **3 November 2026** against [FINN ENAM Final](https://finn-enam-final-mrity.hazyanole2049.chatgpt.site/), Sites version **4**, deployed application commit `18416e11742d8478fc017928900bdd520407b08f`.

Later documentation/evidence-only commits do not change the deployed application/runtime files. The [reviewer guide](../../SUBMISSION.md) explains provenance, live results and remaining limitations.

| Evidence | Contents |
| --- | --- |
| [summary.json](summary.json) | Public-safe release identity, live checks, actual Gemini usage and persistence readbacks |
| [unit.log](unit.log) | 109 passing unit/database tests |
| [api.log](api.log) | 17 passing API tests against the prepared isolated localhost fixture |
| [research-jobs.log](research-jobs.log) | Durable research completion/persistence test |
| [contention.log](contention.log) | Actual Worker regression for held discovery leases, explicit periods and 60-candidate persistence |
| [typecheck.log](typecheck.log), [lint.log](lint.log), [build.log](build.log) | Successful source/build checks |
| [financials.log](financials.log), [dynamic.log](dynamic.log), [retrieved.log](retrieved.log) | Independent Python financial audits; calculation code was unchanged by the hosted discovery fixes |
| [Desktop research](../../screenshots/submission/desktop-gemini-public.png) | Actual public UI with successful Gemini research and a source-linked snapshot |
| [Mobile research](../../screenshots/submission/mobile-gemini-public.png) | Rendered successful public Gemini answer |
| [Mobile Ajanta snapshot](../../screenshots/submission/mobile-ajanta-public.png) | Accepted Q2 FY2027 consolidated values and source links |

These files preserve actual results; copied logs have only line endings and trailing whitespace normalized. Earlier failed/aborted attempts were not counted as successful integrations. Public readbacks and the corrected Havells PULL passed after the hosted reliability fixes. PUSH reused shared source freshness after automatic ingestion; its cached public monitor branch did not exercise monitor-job ownership isolation. Owner isolation was covered in local API/job tests.

No API keys, environment files, visitor cookies, private databases or raw Worker request headers are included. Recurring scheduling remains unconfigured even though all five protected update phases were exercised.
