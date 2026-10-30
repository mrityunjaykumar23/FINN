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
        <span className="muted">Verified historical comparisons · FY2025</span>
      </div>
      {loading ? (
        <Skeleton rows={2} />
      ) : (
        comparisons.map((g, i) => (
          <GuidanceCard
            key={`${g.ticker}-${g.metric}`}
            g={g}
            index={i}
            onResearch={() =>
              onResearch(
                g.ticker,
                "What did management say about FY2025 growth and future margins?",
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
  index,
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
            <small>%</small>
          </strong>
          <p>Management’s stated range</p>
          <span>January 2025 · Q3 earnings call</span>
        </div>
        <div className="guidance-statement actual">
          <div className="mini-eyebrow">02 / THE REPORTED RESULT</div>
          <strong>
            {g.actual}
            <small>%</small>
          </strong>
          <p>
            {g.metric === "Revenue growth"
              ? "Full-year constant-currency growth"
              : "Full-year operating margin"}
          </p>
          <span>April 2025 · Official results</span>
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
            <small>{g.variance !== null && g.variance !== 0 ? "pp" : ""}</small>
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
