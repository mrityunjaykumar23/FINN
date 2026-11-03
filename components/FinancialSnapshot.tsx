"use client";
import { useEffect, useState, useRef } from "react";
import { FileText, RefreshCw } from "lucide-react";
import type { Metric } from "@/lib/types";
import {
  sortPeriods,
  selectMetric,
  latestFinancialPeriod,
} from "@/lib/periods";
import { financialAnalysis } from "@/lib/financial-analysis";
import { sourceLocation } from "@/lib/source-references";
import { financialNumber } from "@/lib/presentation";
import { api, SourceLink } from "./common";
type Snapshot = {
  status: string;
  phase: string;
  readiness: string;
  basis: string;
  sector: string;
  source_states: {
    id: string;
    url: string;
    status: string;
    error: string | null;
    error_code?: string | null;
    failed_stage?: string | null;
  }[];
  period: string | null;
  detail: string | null;
  error: string | null;
  metrics: Metric[];
  documents: { id: string; url: string; source_format?: string }[];
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
  documents: { id: string; url: string; source_format?: string }[];
  onPrepared: (signal: AbortSignal) => Promise<void>;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState<string | undefined>(),
    [basis, setBasis] = useState<string | undefined>(),
    [retry, setRetry] = useState(0),
    [error, setError] = useState("");
  const selection = useRef<{ period?: string; basis?: string }>({});
  useEffect(() => {
    const path = (advance = false) =>
      `companies/${encodeURIComponent(ticker)}/snapshot${advance ? "/advance" : ""}?${new URLSearchParams(selection.current)}`;
    const controller = new AbortController(),
      signal = controller.signal;
    void (async () => {
      let state = await api<Snapshot>(path(), {
        method: "POST",
        body: JSON.stringify({ force: retry > 0 }),
        signal,
      });
      setData(state);
      setError("");
      for (
        let i = 0;
        i < 100 && ["queued", "running"].includes(state.status);
        i++
      ) {
        state = await api<Snapshot>(path(true), {
          method: "POST",
          body: "{}",
          signal,
        });
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
        state = await api<Snapshot>(path(), { signal });
        setData(state);
      }
      if (!signal.aborted) await onPrepared(signal);
    })().catch((e) => {
      if (!signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [ticker, retry, onPrepared]);
  useEffect(() => {
    if (!selected && !basis) return;
    const c = new AbortController();
    void api<Snapshot>(
      `companies/${encodeURIComponent(ticker)}/snapshot?${new URLSearchParams(selection.current)}`,
      { signal: c.signal },
    )
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [ticker, selected, basis]);
  const all = data?.metrics ?? metrics;
  const periods = sortPeriods(all.map((m) => m.period)),
    period = selected ?? latestFinancialPeriod(periods) ?? "";
  const scope =
    basis ??
    (all.some((m) => /consolidated/i.test(m.basis))
      ? "Consolidated"
      : all.some((m) => /standalone/i.test(m.basis))
        ? "Standalone"
        : "Consolidated");
  const filtered = all.filter((m) => new RegExp(scope, "i").test(m.basis));
  const sources = [...documents, ...(data?.documents ?? [])];
  const analysis = financialAnalysis(
    filtered,
    period,
    data?.sector ?? "nonfinancial",
  );
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
            onChange={(e) => {
              selection.current.period = e.target.value;
              setSelected(e.target.value);
            }}
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
            onChange={(e) => {
              selection.current.basis = e.target.value;
              setBasis(e.target.value);
            }}
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
            : data?.readiness === "ready"
              ? `Financial snapshot ready · ${period}`
              : period
                ? `Verified reporting period · ${period} · Evidence gaps remain`
                : "Awaiting source discovery.")}
      </p>
      {["Revenue", "EBITDA", "PBT", "PAT"].map((name) => {
        const m = selectMetric(filtered, name, period),
          doc = sources.find((d) => d.id === m?.document_id);
        let state =
          data?.statuses.find((s) => s.name === name)?.state ??
          "Awaiting source discovery";
        if (
          (state === "Verified" && !m) ||
          (state === "Not disclosed in checked sources" &&
            period !== data?.period)
        )
          state = "Insufficient evidence";
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
              <SourceLink
                url={doc.url}
                page={m.page}
                format={doc.source_format}
              >
                {sourceLocation(m.page, doc.source_format, m.evidence_location)}{" "}
                · {m.unit} · {m.basis}
              </SourceLink>
            )}
          </div>
        );
      })}
      {!!data?.source_states.some((s) => s.error) && (
        <details className="snapshot-details">
          <summary>Source status and recovery</summary>
          {data.source_states
            .filter((s) => s.error)
            .map((s) => (
              <p key={s.id}>
                {s.failed_stage ?? "source"} ·{" "}
                {(s.error_code ?? "source_unavailable").replaceAll("_", " ")}
                <br />
                {s.error}
                <br />
                <SourceLink url={s.url}>Original source</SourceLink>
              </p>
            ))}
        </details>
      )}
      <details className="snapshot-details">
        <summary>Detailed financial analysis</summary>
        {analysis
          .filter((c) => c.status === "verified")
          .map((c) => (
            <div className="snapshot-detail" key={c.name}>
              <strong>
                {c.name}: {financialNumber(c.value!)} {c.unit}
              </strong>
              <small>
                {c.period} · {c.formula}
              </small>
              <details>
                <summary>Inputs and evidence</summary>
                {c.inputs.map((m, i) => (
                  <p key={`${m.id}-${i}`}>
                    {m.name}: {financialNumber(m.value!)} {m.unit} · {m.period}
                    <br />
                    <SourceLink
                      url={
                        m.source_url ??
                        sources.find((d) => d.id === m.document_id)?.url ??
                        ""
                      }
                      page={m.page}
                      format={m.source_format}
                    >
                      {sourceLocation(
                        m.page,
                        m.source_format,
                        m.evidence_location,
                      )}
                    </SourceLink>
                  </p>
                ))}
              </details>
            </div>
          ))}
        <details>
          <summary>Calculation gaps and applicability</summary>
          {analysis
            .filter((c) => c.status !== "verified")
            .map((c) => (
              <p key={c.name}>
                <strong>{c.name}</strong>: {c.reason}
              </p>
            ))}
        </details>
        {Array.from(
          new Set(
            filtered.filter((m) => m.period === period).map((m) => m.name),
          ),
        )
          .map((name) => selectMetric(filtered, name, period))
          .filter((m): m is Metric => !!m)
          .map((m) => (
            <div className="snapshot-detail" key={m.id}>
              <strong>
                {m.name}: {financialNumber(m.value!)} {m.unit}
              </strong>
              {m.original_value != null && (
                <small>
                  Original: {financialNumber(m.original_value)}{" "}
                  {m.original_unit}
                </small>
              )}
              <SourceLink
                url={
                  m.source_url ??
                  sources.find((d) => d.id === m.document_id)?.url ??
                  ""
                }
                page={m.page}
                format={m.source_format}
              >
                {sourceLocation(m.page, m.source_format, m.evidence_location)}
              </SourceLink>
            </div>
          ))}
        {!filtered.some((m) => m.period === period) && (
          <p>No accepted figures are available for this period yet.</p>
        )}
      </details>
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
