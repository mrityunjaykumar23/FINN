"use client";

import { quarterlyComparisons } from "@/lib/periods";
import type { Metric, RankedFiling } from "@/lib/types";
import { ArrowUpRight, BarChart3, ChevronDown, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { financialNumber, publicationLabel } from "@/lib/presentation";

import {
  api,
  ErrorBox,
  Empty,
  labels,
  Modal,
  pct,
  SourceLink,
  TickerIcon,
} from "./common";
export function EventDetail({
  event,
  onClose,
  onResearch,
}: {
  event: RankedFiling;
  onClose: () => void;
  onResearch: (t: string, q?: string) => void;
}) {
  const [data, setData] = useState(event),
    [error, setError] = useState("");
  useEffect(() => {
    api<RankedFiling>(`announcements/${event.id}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [event.id]);
  return (
    <Modal title="The evidence behind the signal" onClose={onClose} wide>
      <div className="detail-company">
        <TickerIcon ticker={data.ticker} />
        <div>
          <strong>{data.company_name}</strong>
          <span>{data.ticker}</span>
        </div>
        <span
          className={`badge ${data.priority === "Critical" ? "critical" : "important"}`}
        >
          {data.priority} · {data.score}/100
        </span>
      </div>
      <h1 className="detail-title">{data.headline}</h1>
      <p className="detail-meta">
        {publicationLabel(data)} · {labels[data.category]}
        <br />
        {data.date_precision}
      </p>
      {error && <ErrorBox message={error} />}
      {data.review_required && (
        <div className="provider-notice" role="status">
          Event requires review. {data.review_reason} The original source and
          record are retained.
        </div>
      )}
      <div className="detail-summary">
        <h3>What changed</h3>
        <p>{data.summary}</p>
        <h3>Why it deserves a closer look</h3>
        <p>{data.why}</p>
        {data.materiality_reasons && (
          <details>
            <summary>Why this priority score?</summary>
            <ul>
              {data.materiality_reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            <p>
              Magnitude:{" "}
              {data.materiality_attributes?.magnitude_status.replaceAll(
                "_",
                " ",
              )}
              . Score indicates attention priority, not a price prediction.
            </p>
          </details>
        )}
      </div>
      {data.category === "results" && (
        <FinancialTable
          metrics={data.metrics ?? []}
          sourceUrls={data.metric_source_urls ?? {}}
        />
      )}
      <details className="evidence-details" open>
        <summary>
          <FileText size={16} />
          Extracted source evidence <ChevronDown size={14} />
        </summary>
        <div className="evidence-content">
          <div className="evidence-meta">
            <span>ORIGINAL DOCUMENT · PDF PAGE {data.evidence_page}</span>
            <SourceLink url={data.source_url} page={data.evidence_page} />
          </div>
          <pre>{data.evidence_text ?? "Loading original text…"}</pre>
        </div>
      </details>
      {data.supporting_sources?.map((source) => (
        <details
          className="evidence-details"
          key={`${source.document_id}-${source.page}`}
        >
          <summary>
            <FileText size={16} />
            Supporting evidence · {source.period}
            <ChevronDown size={14} />
          </summary>
          <div className="evidence-content">
            <div className="evidence-meta">
              <span>
                PDF PAGE {source.page} · {source.title}
              </span>
              <SourceLink url={source.url} page={source.page} />
            </div>
            <pre>{source.text}</pre>
          </div>
        </details>
      ))}
      <details className="evidence-details">
        <summary>
          <BarChart3 size={16} />
          Why FINN ranked this here <ChevronDown size={14} />
        </summary>
        <div className="score-parts">
          {Object.entries(data.breakdown).map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <div>
                <i
                  style={{
                    width: `${(value / ({ severity: 40, magnitude: 25, relevance: 15, novelty: 10, evidence: 10 }[label] ?? 40)) * 100}%`,
                  }}
                />
              </div>
              <strong>{value}</strong>
            </div>
          ))}
          <p>
            Attention score, not a price forecast. Evidence confidence:{" "}
            {data.confidence}.
          </p>
        </div>
      </details>
      <div className="follow-up">
        <h3>Continue the investigation</h3>
        {data.questions.map((q) => (
          <button key={q} onClick={() => onResearch(data.ticker, q)}>
            {q}
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function FinancialTable({
  metrics,
  sourceUrls,
}: {
  metrics: Metric[];
  sourceUrls: Record<string, string>;
}) {
  const comparisons = quarterlyComparisons(metrics);
  const periods = comparisons[0].periods;
  if (!periods.length)
    return (
      <Empty title="No comparable quarterly facts available.">
        Inspect the original disclosure. Missing financial values and periods
        are not inferred.
      </Empty>
    );
  return (
    <section className="financial-section">
      <h3>The quarter, in numbers</h3>
      <p className="muted">
        {metrics[0]?.unit ?? "Unit unavailable"} ·{" "}
        {metrics[0]?.basis ?? "Accounting basis unavailable"}
      </p>
      <div className="table-scroll">
        <table className="financial-table">
          <thead>
            <tr>
              <th>Metric</th>
              {periods.map((p) => (
                <th key={p}>{p}</th>
              ))}
              <th>QoQ</th>
              <th>YoY</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map(({ name, values, qoq, yoy }) => {
              return (
                <tr key={name}>
                  <th>
                    {name}
                    <small
                      className="muted"
                      style={{
                        display: "block",
                        maxWidth: 160,
                        fontWeight: 400,
                      }}
                    >
                      {values[0]?.unit} · {values[0]?.basis}
                    </small>
                  </th>
                  {values.map((m, i) => (
                    <td key={i}>
                      {m?.value == null ? (
                        <span className="not-reported">Not reported</span>
                      ) : sourceUrls[m.document_id] ? (
                        <a
                          href={`${sourceUrls[m.document_id]}#page=${m.page}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`${m.period} · ${m.basis} · PDF page ${m.page}`}
                          aria-label={`${name}, ${m.period}: ${financialNumber(m.value)} ${m.unit}, ${m.basis}; open source page ${m.page}`}
                        >
                          {financialNumber(m.value)}
                          <sup>{m.page}</sup>
                        </a>
                      ) : (
                        <span title="Original document link unavailable">
                          {financialNumber(m.value)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td>{pct(qoq)}</td>
                  <td>{pct(yoy)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        Superscripts refer to source PDF pages. PAT retains its source&apos;s
        reported definition. Missing metrics are not approximated. Growth ratios
        with a zero or negative base are unavailable.
      </p>
    </section>
  );
}
