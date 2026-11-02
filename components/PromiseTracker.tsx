"use client";

import type { GuidanceResult } from "@/lib/types";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  FileText,
  Info,
  ShieldCheck,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  api,
  ErrorBox,
  short,
  Skeleton,
  SourceLink,
  TickerIcon,
} from "./common";
export function PromiseTracker({
  onResearch,
}: {
  onResearch: (t: string, q?: string) => void;
}) {
  const [comparisons, setComparisons] = useState<GuidanceResult[]>([]),
    [companyFilter, setCompanyFilter] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    api<{ comparisons: GuidanceResult[] }>("guidance")
      .then((r) => setComparisons(r.comparisons))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Target size={14} /> MANAGEMENT PROMISE TRACKER
          </div>
          <h1>
            The words.
            <br />
            <em>Then, the numbers.</em>
          </h1>
          <p>
            Compare explicit numerical guidance with comparable reported
            results.
            <br className="desktop-break" />
            Same company. Same period. Same definition. Two sources.
          </p>
        </div>
        <span className="evidence-seal">
          <ShieldCheck size={23} />
          PRIMARY
          <br />
          EVIDENCE
        </span>
      </div>
      <div className="tracker-intro">
        <div>
          <CheckCheck size={20} />
          <strong>A comparison, with context.</strong>
        </div>
        <p>
          A result below guidance is a reason to investigate. It does not
          establish deception. Qualifiers and revisions matter as much as the
          number.
        </p>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="section-heading">
        <h2>
          Guidance vs. delivery{" "}
          <span className="count-pill">{comparisons.length}</span>
        </h2>
        <span className="muted">Stored primary-source comparisons</span>
      </div>
      <label className="muted">
        Company{" "}
        <select
          aria-label="Filter guidance by company"
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
        >
          <option value="">All companies</option>
          {[...new Set(comparisons.map((g) => g.ticker))].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <Skeleton rows={2} />
      ) : (
        comparisons
          .filter((g) => !companyFilter || g.ticker === companyFilter)
          .map((g, i) => (
            <GuidanceCard
              key={g.id ?? `${g.ticker}-${g.metric}-${i}`}
              g={g}
              index={i}
              onResearch={() =>
                onResearch(
                  g.ticker,
                  `What did management guide for ${g.period} and what was reported?`,
                )
              }
            />
          ))
      )}
      <div className="tracker-next">
        <div>
          <Target size={22} />
          <h3>Every comparison has to earn its place.</h3>
          <p>
            Only explicit guidance with aligned periods and definitions is
            scored. Other companies return “Insufficient comparable evidence”
            until both sources are available.
          </p>
        </div>
        <button
          className="secondary-button"
          onClick={() =>
            onResearch(
              "ASIANPAINT.NS",
              "What numerical guidance did management give?",
            )
          }
        >
          Investigate another company <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
}

export function GuidanceCard({
  g,
  onResearch,
}: {
  g: GuidanceResult;
  index: number;
  onResearch: () => void;
}) {
  return (
    <article className="guidance-card">
      <div className="guidance-card-head">
        <div className="signal-company">
          <TickerIcon ticker={g.ticker} />
          <div>
            <strong>
              {short(g.ticker)} · {g.metric}
            </strong>
            <span>
              {g.period} <span>·</span> {g.basis}
            </span>
          </div>
        </div>
        <span
          className={`badge ${g.variance === null ? "neutral" : g.variance < 0 ? "critical" : "verified"}`}
        >
          {g.status}
        </span>
      </div>
      <div className="guidance-comparison">
        <div className="guidance-statement">
          <div className="mini-eyebrow">01 / THE GUIDANCE</div>
          <strong>
            {g.low}–{g.high}
            <small>
              {/^(%|percent|percentage)$/i.test(g.unit ?? "%")
                ? "%"
                : ` ${g.unit}`}
            </small>
          </strong>
          <p>
            {g.guidance_type ?? "range"}
            {g.revised ? " · revised guidance" : ""}
          </p>
          <span>
            {g.stated_at
              ? `Stated ${g.stated_at.slice(0, 10)} → target ${g.period}`
              : `${g.sources[0]?.period} · Statement date unverified`}
          </span>
        </div>
        <div className="guidance-statement actual">
          <div className="mini-eyebrow">02 / THE REPORTED RESULT</div>
          <strong>
            {g.actual ?? "Unavailable"}
            <small>
              {g.actual == null
                ? ""
                : /^(%|percent|percentage)$/i.test(g.unit ?? "%")
                  ? "%"
                  : ` ${g.unit}`}
            </small>
          </strong>
          <p>
            {g.metric} · {g.period}
          </p>
          <span>{g.actual_period || "Actual result not yet available"}</span>
        </div>
        <div className="guidance-verdict">
          <div className="mini-eyebrow">THE DIFFERENCE</div>
          <strong
            className={
              g.variance !== null && g.variance < 0 ? "negative" : "positive"
            }
          >
            {g.variance === null ? (
              "—"
            ) : g.variance === 0 ? (
              <Check size={36} />
            ) : (
              `${g.variance > 0 ? "+" : "−"}${Math.abs(g.variance).toFixed(1)}`
            )}
            <small>
              {g.variance !== null && g.variance !== 0
                ? g.unit === "%" || !g.unit
                  ? "pp"
                  : g.unit
                : ""}
            </small>
          </strong>
          <p>{g.explanation}</p>
        </div>
      </div>
      <div className="guidance-qualifier">
        <Info size={14} />
        <p>{g.qualifier}</p>
      </div>
      <div className="guidance-source-grid">
        {g.sources.map((s, i) => (
          <details key={`${s.document_id}-${i}`}>
            <summary>
              <FileText size={14} />
              <div>
                <strong>
                  {i === 0 ? "The management statement" : "The reported result"}
                </strong>
                <span>
                  {s.period} · PDF page {s.page}
                </span>
              </div>
              <ChevronDown size={14} />
            </summary>
            <div className="guidance-source-text">
              <pre>{s.text}</pre>
              <SourceLink url={s.url} page={s.page}>
                Read original source
              </SourceLink>
            </div>
          </details>
        ))}
      </div>
      <button className="guidance-follow" onClick={onResearch}>
        Ask what sits behind the numbers <ArrowUpRight size={15} />
      </button>
    </article>
  );
}
