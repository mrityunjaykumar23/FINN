"use client";

import { categories } from "@/lib/domain";
import type { Company, Digest, RankedFiling } from "@/lib/types";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Info,
  ListFilter,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { publicationLabel } from "@/lib/presentation";

import {
  api,
  date,
  Empty,
  ErrorBox,
  labels,
  num,
  pct,
  short,
  Skeleton,
  TickerIcon,
  View,
} from "./common";
export function Briefing({
  companies,
  mode,
  revision,
  onEvent,
  onResearch,
  onView,
  onSources,
}: {
  companies: Company[];
  mode: string;
  revision: number;
  onEvent: (e: RankedFiling) => void;
  onResearch: (ticker: string, question?: string) => void;
  onView: (v: View) => void;
  onSources: () => void;
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const [days, setDays] = useState("1"),
    [company, setCompany] = useState(""),
    [category, setCategory] = useState(""),
    [customStart, setCustomStart] = useState(
      mode === "historical" ? "2025-04-16" : today,
    ),
    [customEnd, setCustomEnd] = useState(
      mode === "historical" ? "2025-04-22" : today,
    );
  const [digest, setDigest] = useState<Digest | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [routine, setRoutine] = useState(false),
    [paging, setPaging] = useState(false);
  const windowParams = () => {
    const p = new URLSearchParams({
      mode,
      days: days === "custom" ? "7" : days,
    });
    if (company) p.set("ticker", company);
    if (category) p.set("category", category);
    if (days === "custom") {
      p.set("start", customStart);
      p.set("end", customEnd);
    }
    return p;
  };
  async function more(side: "events" | "routine") {
    const cursor =
      side === "events" ? digest?.next_cursor : digest?.next_routine_cursor;
    if (!cursor) return;
    setPaging(true);
    setError("");
    try {
      const p = windowParams();
      p.set(side === "events" ? "cursor" : "routine_cursor", cursor);
      const next = await api<Digest>(`digest?${p}`);
      setDigest((old) =>
        old
          ? {
              ...old,
              [side]: [
                ...old[side],
                ...next[side].filter(
                  (x) => !old[side].some((y) => y.id === x.id),
                ),
              ],
              ...(side === "events"
                ? { next_cursor: next.next_cursor }
                : { next_routine_cursor: next.next_routine_cursor }),
            }
          : next,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPaging(false);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    queueMicrotask(() => {
      if (!abort.signal.aborted) {
        setLoading(true);
        setError("");
      }
    });
    const params = new URLSearchParams({
      mode,
      days: days === "custom" ? "7" : days,
    });
    if (company) params.set("ticker", company);
    if (category) params.set("category", category);
    if (days === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    api<Digest>(`digest?${params}`, { signal: abort.signal })
      .then(setDigest)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [days, company, category, mode, revision, customStart, customEnd, retry]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            PORTFOLIO INTELLIGENCE <span className="eyebrow-line" />
          </div>
          <h1>Signal over noise.</h1>
          <p>Know what changed, why it matters, and what the evidence says.</p>
        </div>
        <div className="edition">
          <span>
            {mode === "historical" ? "HISTORICAL EDITION" : "CURRENT EDITION"}
          </span>
          <strong>
            {mode === "historical"
              ? "22 April 2025"
              : date(
                  new Intl.DateTimeFormat("en-CA", {
                    timeZone: "Asia/Kolkata",
                  }).format(new Date()),
                )}
          </strong>
          <small>Indian markets · End of day</small>
        </div>
      </div>
      <div className="briefing-toolbar">
        <div className="portfolio-label">
          <BriefcaseBusiness size={15} />
          <strong>My portfolio</strong>
          <span>{companies.length} companies</span>
        </div>
        <div className="segmented" aria-label="Briefing window">
          {[
            ["1", mode === "historical" ? "1 calendar day" : "24 hours"],
            ["7", "7 days"],
            ["custom", "Custom"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setDays(value)}
              aria-pressed={days === value}
              className={days === value ? "selected" : ""}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {days === "custom" && (
        <div className="custom-dates">
          <label>
            From
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
          </label>
          <span>→</span>
          <label>
            Through
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="stats-strip">
        <div>
          <span>NEEDS YOUR ATTENTION</span>
          <strong>
            {loading
              ? "—"
              : String(digest?.important_count ?? 0).padStart(2, "0")}
            <span className="stat-dot amber" />
          </strong>
          <small>prioritised developments</small>
        </div>
        <div>
          <span>MARKET ANOMALIES</span>
          <strong>
            {loading
              ? "—"
              : String(digest?.market_alerts.length ?? 0).padStart(2, "0")}
            <Activity size={21} />
          </strong>
          <small>price & volume thresholds</small>
        </div>
        <div>
          <span>COMPANIES WITH EVENTS</span>
          <strong>
            {loading
              ? "—"
              : String(digest?.companies_with_events ?? 0).padStart(2, "0")}
            <ListFilter size={20} />
          </strong>
          <small>{digest?.routine_count ?? 0} lower-priority updates</small>
        </div>
        <div className="coverage-stat">
          <span>SUCCESSFULLY CHECKED</span>
          <strong>
            {digest?.covered_companies ?? "—"}
            <small>/ {companies.length}</small>
            <ShieldCheck size={20} />
          </strong>
          <small>
            {digest?.monitored_companies ?? 0} monitored ·{" "}
            {Math.max(0, companies.length - (digest?.covered_companies ?? 0))}{" "}
            unconfirmed
          </small>
        </div>
      </div>
      <div className="coverage-summary">
        <span>
          <ShieldCheck size={14} />
          Last successful source check:{" "}
          {digest?.last_successful_announcement_check
            ? date(digest.last_successful_announcement_check)
            : "not established"}
        </span>
        <button className="text-button" onClick={onSources}>
          Coverage & limitations <ArrowUpRight size={12} />
        </button>
      </div>
      <div className="briefing-grid">
        <div className="feed-column">
          <div className="section-heading">
            <h2>
              Your intelligence briefing
              <span className="count-pill">{digest?.important_count ?? 0}</span>
            </h2>
            <span className="muted">Ranked by relevance</span>
          </div>
          <div className="feed-filters">
            <label>
              <span className="sr-only">Filter by company</span>
              <select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option value={c.ticker} key={c.ticker}>
                    {short(c.ticker)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All event types</option>
                {categories.map((c) => (
                  <option value={c} key={c}>
                    {labels[c]}
                  </option>
                ))}
              </select>
            </label>
            <span className="source-freshness">
              <Clock3 size={12} />
              {digest
                ? `${date(digest.start)}${digest.start !== digest.end ? ` – ${date(digest.end)}` : ""}`
                : "Loading window"}
            </span>
          </div>
          {error ? (
            <ErrorBox message={error} retry={() => setRetry((x) => x + 1)} />
          ) : loading ? (
            <Skeleton rows={2} />
          ) : (
            <>
              {!digest?.events.length && (
                <Empty
                  title={
                    mode === "live" && !digest?.covered_companies
                      ? "Announcement coverage is not established."
                      : "No important announcements found in this window."
                  }
                >
                  {mode === "live" && !digest?.covered_companies
                    ? "Sources could not be confirmed checked for this portfolio and window. Missing coverage does not establish that no announcements occurred."
                    : "Try a wider period or inspect lower-priority updates. Source coverage remains limited to the checks shown above."}
                </Empty>
              )}
              {digest?.events.map((event, i) => (
                <SignalCard
                  key={event.id}
                  event={event}
                  index={i + 1}
                  onOpen={() => onEvent(event)}
                  onResearch={() =>
                    onResearch(event.ticker, event.questions[0])
                  }
                />
              ))}
              {digest?.next_cursor && (
                <button
                  className="secondary-button"
                  disabled={paging}
                  onClick={() => void more("events")}
                >
                  {paging ? "Loading…" : "View more prioritised filings"}
                </button>
              )}
              {!!digest?.market_alerts.length && (
                <section className="market-signals">
                  <div className="section-heading">
                    <h3>
                      <Activity size={16} /> Outside the ordinary
                    </h3>
                    <button
                      className="text-button"
                      onClick={() => onView("settings")}
                    >
                      Edit thresholds <SlidersHorizontal size={12} />
                    </button>
                  </div>
                  {digest.market_alerts.slice(0, 6).map((a) => (
                    <button
                      className="movement-row"
                      key={a.id}
                      onClick={() => onResearch(a.ticker)}
                    >
                      <TickerIcon ticker={a.ticker} small />
                      <div>
                        <strong>
                          {short(a.ticker)}
                          <span
                            className={`mono ${a.type === "volume" ? "amber-text" : a.value < 0 ? "negative" : "positive"}`}
                          >
                            {a.type === "volume"
                              ? `${a.value.toFixed(2)}× volume`
                              : pct(a.value)}
                          </span>
                        </strong>
                        <p>{a.text}</p>
                        <small>{date(a.date)} · EOD</small>
                      </div>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                  {digest.market_alerts.length > 6 && (
                    <p className="muted">
                      {digest.market_alerts.length - 6} additional triggers in
                      this window. Narrow the company filter to inspect them.
                    </p>
                  )}
                </section>
              )}
              <div className="routine-section">
                <button
                  className="routine-toggle"
                  onClick={() => setRoutine(!routine)}
                  aria-expanded={routine}
                >
                  <div className="routine-icon">
                    <ListFilter size={17} />
                  </div>
                  <div>
                    <strong>The noise, neatly tucked away.</strong>
                    <span>
                      {digest?.routine_count ?? 0} lower-priority updates ·
                      available when you need them
                    </span>
                  </div>
                  <ChevronDown size={17} className={routine ? "rotate" : ""} />
                </button>
                {routine && (
                  <div className="routine-list">
                    {digest?.routine.length ? (
                      digest.routine.map((e) => (
                        <button key={e.id} onClick={() => onEvent(e)}>
                          <span className="badge neutral">{e.priority}</span>
                          <div>
                            <strong>
                              {short(e.ticker)} · {e.headline}
                            </strong>
                            <small>
                              {labels[e.category]} · {date(e.date)}
                            </small>
                          </div>
                          <ChevronRight size={15} />
                        </button>
                      ))
                    ) : (
                      <p>No lower-priority updates in the selected window.</p>
                    )}
                    {digest?.next_routine_cursor && (
                      <button
                        className="secondary-button"
                        disabled={paging}
                        onClick={() => void more("routine")}
                      >
                        {paging ? "Loading…" : "View more routine filings"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          <p className="coverage-note">
            <Info size={13} />
            {mode === "historical"
              ? "A verified replay, not a complete exchange feed. Date-only disclosures use calendar-day windows."
              : "Bounded source checks run on opening. Timestamped filings use rolling windows; date-only disclosures retain calendar-date precision. Empty coverage does not mean no filings occurred."}
          </p>
          {!!digest?.unavailable_source_companies.length && (
            <p className="coverage-note">
              Unavailable announcement sources:{" "}
              {digest.unavailable_source_companies.join(", ")}.
            </p>
          )}
        </div>
        <aside className="right-rail">
          <div className="promise-preview">
            <div className="mini-eyebrow">
              <Target size={14} /> THE PROMISE TRACKER<span>01</span>
            </div>
            <h3>
              What was said.
              <br />
              <em>What was delivered.</em>
            </h3>
            <p>Put management’s guidance next to the reported result.</p>
            {mode === "historical" ? (
              <>
                <div className="promise-company">
                  <TickerIcon ticker="INFY.NS" small />
                  <strong>Infosys</strong>
                  <span>FY2025</span>
                </div>
                <div className="promise-numbers">
                  <div>
                    <span>GUIDED</span>
                    <strong>
                      4.5–5.0<small>%</small>
                    </strong>
                  </div>
                  <span className="compare-arrow">→</span>
                  <div>
                    <span>DELIVERED</span>
                    <strong>
                      4.2<small>%</small>
                    </strong>
                  </div>
                </div>
                <div className="variance-line">
                  <span className="negative">−0.3 pp</span>
                  <span>below the lower bound</span>
                </div>
                <div className="promise-footnote">
                  Constant-currency revenue growth · January revised guidance
                </div>
              </>
            ) : (
              <div className="promise-footnote">
                View the latest stored guidance for each company and metric,
                with its target period, original statement and comparable
                result. Missing current evidence remains unavailable.
              </div>
            )}
            <button onClick={() => onView("promises")}>
              Follow the evidence <ArrowRight size={15} />
            </button>
          </div>
          <div className="portfolio-pulse">
            <div className="section-heading">
              <h3>Portfolio pulse</h3>
              <span className="tiny-label">DAILY CLOSE</span>
            </div>
            {companies
              .slice()
              .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
              .slice(0, 5)
              .map((c) => (
                <button key={c.ticker} onClick={() => onResearch(c.ticker)}>
                  <TickerIcon ticker={c.ticker} small />
                  <div>
                    <strong>{short(c.ticker)}</strong>
                    <small>₹{num(c.close)}</small>
                  </div>
                  <span
                    className={
                      (c.change ?? 0) < 0 ? "negative mono" : "positive mono"
                    }
                  >
                    {pct(c.change)}
                  </span>
                </button>
              ))}
            <button
              className="view-portfolio"
              onClick={() => onView("portfolio")}
            >
              View all {companies.length} companies <ArrowRight size={13} />
            </button>
            <p>
              {mode === "historical"
                ? "Historical closes"
                : "Completed EOD closes"}{" "}
              ·{" "}
              {mode === "historical"
                ? "22 Apr 2025"
                : companies
                      .map((c) => c.date)
                      .filter((d): d is string => !!d)
                      .sort()
                      .at(-1)
                  ? date(
                      companies
                        .map((c) => c.date)
                        .filter((d): d is string => !!d)
                        .sort()
                        .at(-1)!,
                    )
                  : "No verified session"}
              <br />
              Percentage moves use adjusted prices.
            </p>
          </div>
          <div className="research-nudge">
            <Sparkles size={19} />
            <h3>A question worth asking.</h3>
            <p>Does the cash flow support the reported profit?</p>
            <button
              onClick={() =>
                onResearch(
                  "HCLTECH.NS",
                  "Does cash flow support reported profitability?",
                )
              }
            >
              Investigate HCLTech <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

export function SignalCard({
  event,
  index,
  onOpen,
  onResearch,
}: {
  event: RankedFiling;
  index: number;
  onOpen: () => void;
  onResearch: () => void;
}) {
  return (
    <article className="signal-card">
      <div className="signal-topline">
        <div className="signal-company">
          <TickerIcon ticker={event.ticker} />
          <div>
            <strong>{event.company_name}</strong>
            <span>
              {short(event.ticker)} <span>·</span> {labels[event.category]}
            </span>
          </div>
        </div>
        <span
          className={`badge ${event.priority === "Critical" ? "critical" : "important"}`}
        >
          <span />
          {event.priority}
        </span>
      </div>
      <button className="signal-main" onClick={onOpen}>
        <div className="signal-number">{String(index).padStart(2, "0")}</div>
        <div>
          <h3>{event.headline}</h3>
          <p>{event.summary}</p>
        </div>
        <ArrowUpRight className="signal-arrow" size={21} />
      </button>
      <div className="why-box">
        <span>
          <Sparkles size={13} /> WHY IT MATTERS
        </span>
        <p>{event.why}</p>
      </div>
      <div className="signal-footer">
        <button className="evidence-button" onClick={onOpen}>
          <FileText size={13} />
          Inspect evidence <ChevronRight size={12} />
        </button>
        <span title={event.date_precision}>{publicationLabel(event)}</span>
        <button className="research-button" onClick={onResearch}>
          Dig deeper <ArrowRight size={13} />
        </button>
      </div>
    </article>
  );
}
