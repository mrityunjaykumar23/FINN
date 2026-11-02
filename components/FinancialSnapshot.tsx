"use client";
import { useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import type { Metric } from "@/lib/types";
import { sortPeriods, selectMetric } from "@/lib/periods";
import { financialNumber } from "@/lib/presentation";
import { api, SourceLink } from "./common";
type Snapshot = {
  status: string;
  phase: string;
  period: string | null;
  detail: string | null;
  error: string | null;
  metrics: Metric[];
  documents: { id: string; url: string }[];
  statuses: { name: string; state: string }[];
  financial_errors: string[];
};
export function FinancialSnapshot({
  ticker,
  metrics,
  documents,
  onPrepared,
}: {
  ticker: string;
  metrics: Metric[];
  documents: { id: string; url: string }[];
  onPrepared: (signal: AbortSignal) => Promise<void>;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState<string | undefined>(),
    [basis, setBasis] = useState<string | undefined>(),
    [retry, setRetry] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(),
      signal = controller.signal;
    void (async () => {
      let state = await api<Snapshot>(
        `companies/${encodeURIComponent(ticker)}/snapshot`,
        { method: "POST", body: JSON.stringify({ force: retry > 0 }), signal },
      );
      setData(state);
      setError("");
      for (
        let i = 0;
        i < 100 && ["queued", "running"].includes(state.status);
        i++
      ) {
        state = await api<Snapshot>(
          `companies/${encodeURIComponent(ticker)}/snapshot/advance`,
          { method: "POST", body: "{}", signal },
        );
        setData(state);
        await new Promise<void>((resolve, reject) => {
          const cancel = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", cancel);
            resolve();
          }, 1500);
          signal.addEventListener("abort", cancel, { once: true });
        });
        state = await api<Snapshot>(
          `companies/${encodeURIComponent(ticker)}/snapshot`,
          { signal },
        );
        setData(state);
      }
      if (!signal.aborted) await onPrepared(signal);
    })().catch((e) => {
      if (!signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [ticker, retry, onPrepared]);
  const all = data?.metrics ?? metrics;
  const periods = sortPeriods(all.map((m) => m.period)),
    period =
      selected ?? periods.find((p) => p.startsWith("Q")) ?? periods[0] ?? "";
  const scope =
    basis ??
    (all.some((m) => /consolidated/i.test(m.basis))
      ? "Consolidated"
      : all.some((m) => /standalone/i.test(m.basis))
        ? "Standalone"
        : "Consolidated");
  const filtered = all.filter((m) => new RegExp(scope, "i").test(m.basis));
  const sources = [...documents, ...(data?.documents ?? [])];
  const active =
    !!data && ["queued", "running"].includes(data.status) && !error;
  return (
    <section className="snapshot-panel" aria-label="Financial snapshot">
      <div className="section-heading">
        <h3>Financial snapshot</h3>
        <FileText size={15} />
      </div>
      <div className="snapshot-controls">
        <label>
          <span className="sr-only">Financial snapshot period</span>
          <select
            aria-label="Financial snapshot period"
            value={period}
            disabled={!periods.length}
            onChange={(e) => setSelected(e.target.value)}
          >
            {!periods.length && (
              <option value="">No verified period yet</option>
            )}
            {periods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Financial snapshot basis</span>
          <select
            aria-label="Financial snapshot basis"
            value={scope}
            onChange={(e) => setBasis(e.target.value)}
          >
            <option>Consolidated</option>
            <option>Standalone</option>
          </select>
        </label>
      </div>
      <p className="snapshot-progress" role="status">
        {active && <RefreshCw size={12} className="spin" />}
        {error ||
          data?.error ||
          (active
            ? `${data.phase.replaceAll("_", " ")}: ${data.detail ?? "Checking original financial sources…"}`
            : period
              ? `Verified reporting period · ${period}`
              : "Not yet extracted. Checking original results.")}
      </p>
      {["Revenue", "EBITDA", "PBT", "PAT"].map((name) => {
        const m = selectMetric(filtered, name, period),
          doc = sources.find((d) => d.id === m?.document_id);
        let state = active
          ? "Extraction in progress"
          : error || data?.status === "failed" || data?.financial_errors.length
            ? "Extraction failed"
            : (data?.statuses.find((s) => s.name === name)?.state ??
              "Not yet extracted");
        if (
          (state === "Verified value" && !m) ||
          (state === "Not disclosed in the verified source" &&
            period !== data?.period)
        )
          state = "Insufficient source evidence";
        return (
          <div className="snapshot-metric" key={name}>
            <span>{name}</span>
            <strong>
              {m?.value == null ? (
                <small>{state}</small>
              ) : (
                `${m.unit.startsWith("INR") ? "₹" : ""}${financialNumber(m.value)}`
              )}
            </strong>
            {m && doc && (
              <SourceLink url={doc.url} page={m.page}>
                PDF p.{m.page} · {m.unit} · {m.basis}
              </SourceLink>
            )}
          </div>
        );
      })}
      <p>
        Only accepted source-backed figures are shown. Quarterly and half-year
        periods remain separate.
      </p>
      <button
        className="small-button"
        disabled={active}
        onClick={() => setRetry((r) => r + 1)}
        aria-label="Retry financial preparation"
      >
        <RefreshCw size={13} />
        {active ? "Processing originals…" : "Refresh financial sources"}
      </button>
    </section>
  );
}
