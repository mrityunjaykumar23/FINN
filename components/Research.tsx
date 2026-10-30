"use client";

import type {
  Company,
  Document,
  GuidanceResult,
  Metric,
  Research,
} from "@/lib/types";
import {
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  FileText,
  Info,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  api,
  date,
  Empty,
  ErrorBox,
  num,
  short,
  Skeleton,
  SourceLink,
  TickerIcon,
} from "./common";

type Overview = {
  company: Company;
  metrics: Metric[];
  documents: Omit<Document, "pages">[];
  points: {
    date: string;
    close: number;
    adjusted_close: number;
    volume: number;
  }[];
  guidance: GuidanceResult[];
  mode: string;
};
export function ResearchView({
  ticker,
  initialQuestion,
  companies,
  mode,
  onSearch,
  onCompany,
  notify,
  onPortfolioChange,
}: {
  ticker: string;
  initialQuestion: string;
  companies: Company[];
  mode: string;
  onSearch: () => void;
  onCompany: (t: string, q?: string) => void;
  notify: (m: string) => void;
  onPortfolioChange: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [answer, setAnswer] = useState<Research | null>(null),
    [question, setQuestion] = useState(initialQuestion),
    [asking, setAsking] = useState(false),
    [busy, setBusy] = useState(false),
    [type, setType] = useState(""),
    [period, setPeriod] = useState(""),
    [chartType, setChartType] = useState("price"),
    [metricPeriod, setMetricPeriod] = useState("Q4 FY2025");
  const answerRef = useRef<HTMLDivElement>(null);
  const ask = useCallback(
    async (q: string, filters: { type?: string; period?: string } = {}) => {
      setAsking(true);
      setError("");
      setQuestion(q);
      try {
        const data = await api<Research>("research", {
          method: "POST",
          body: JSON.stringify({ ticker, question: q, ...filters }),
        });
        setAnswer(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setAsking(false);
      }
    },
    [ticker],
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setAnswer(null);
    setOverview(null);
    setError("");
    setQuestion(initialQuestion);
    setType("");
    setPeriod("");
    api<Overview>(
      `companies/${encodeURIComponent(ticker)}/overview?mode=${mode}`,
    )
      .then((d) => {
        if (active) {
          setOverview(d);
          if (initialQuestion) void ask(initialQuestion);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ticker, mode, initialQuestion, ask]);
  async function add() {
    setBusy(true);
    try {
      await api("portfolio", {
        method: "POST",
        body: JSON.stringify({ ticker }),
      });
      onPortfolioChange();
      notify(`${short(ticker)} added to your portfolio.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      const result = await api<{ sessions: number }>("market/refresh", {
        method: "POST",
        body: JSON.stringify({ ticker }),
      });
      if (mode === "live") {
        setOverview(
          await api<Overview>(
            `companies/${encodeURIComponent(ticker)}/overview?mode=live`,
          ),
        );
        onPortfolioChange();
      }
      notify(
        `${result.sessions} completed daily sessions retrieved. ${mode === "historical" ? "Select live mode to view them." : "Live chart updated."}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const exists = companies.some((c) => c.ticker === ticker);
  const suggestions = [
    "How has revenue growth changed?",
    "Does cash flow support reported profitability?",
    "What did management guide for future margins?",
    "What were the major risks mentioned in the annual report?",
  ];
  const activeMetrics =
    overview?.metrics.filter((m) => m.period === metricPeriod) ?? [];
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">YOUR PRIMARY-SOURCE RESEARCH DESK</div>
          <h1>
            Go beyond
            <br />
            <em>the headline.</em>
          </h1>
          <p>
            Ask a better question. Follow it back to the company’s own words.
          </p>
        </div>
        <button className="secondary-button" onClick={onSearch}>
          <Search size={16} />
          Find a company
        </button>
      </div>
      <div className="research-examples">
        <span>EXPLORE BEYOND YOUR PORTFOLIO</span>
        {["ASIANPAINT.NS", "PERSISTENT.NS", "DMART.NS"].map((t) => (
          <button
            key={t}
            className={t === ticker ? "selected" : ""}
            onClick={() => onCompany(t)}
          >
            {short(t)}
            <ArrowUpRight size={12} />
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      {loading ? (
        <Skeleton rows={3} />
      ) : (
        overview && (
          <>
            <div className="research-company-header">
              <TickerIcon ticker={ticker} />
              <div>
                <h2>{overview.company.name}</h2>
                <span>
                  {ticker} <span>·</span> {overview.company.sector}
                </span>
              </div>
              <div className="research-company-actions">
                <button
                  className={`small-button ${exists ? "added" : ""}`}
                  disabled={exists || busy}
                  onClick={add}
                >
                  {exists ? <Check size={14} /> : <Plus size={14} />}{" "}
                  {exists ? "In your portfolio" : "Follow company"}
                </button>
                <button
                  className="icon-button"
                  onClick={refresh}
                  disabled={busy}
                  aria-label="Fetch latest completed market sessions"
                >
                  <RefreshCw size={16} className={busy ? "spin" : ""} />
                </button>
              </div>
            </div>
            <div className="research-grid">
              <div className="research-main">
                <section className="question-panel">
                  <div className="mini-eyebrow">
                    <Sparkles size={14} />
                    ASK FINN
                  </div>
                  <h3>What would you like to understand?</h3>
                  <form
                    onSubmit={(e: FormEvent) => {
                      e.preventDefault();
                      if (question.trim().length >= 3)
                        void ask(question, {
                          ...(type && { type }),
                          ...(period && { period }),
                        });
                    }}
                  >
                    <label className="sr-only" htmlFor="research-question">
                      Research question
                    </label>
                    <textarea
                      id="research-question"
                      placeholder={`Ask about ${overview.company.name}…`}
                      maxLength={800}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      rows={2}
                    />
                    <div className="question-controls">
                      <div>
                        <label>
                          <span className="sr-only">Document type</span>
                          <select
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                          >
                            <option value="">All primary documents</option>
                            <option value="annual_report">
                              Annual reports
                            </option>
                            <option value="transcript">Call transcripts</option>
                            <option value="results">Financial results</option>
                          </select>
                        </label>
                        <label>
                          <span className="sr-only">Reporting period</span>
                          <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value)}
                          >
                            <option value="">All periods</option>
                            {[
                              ...new Set(
                                overview.documents.map((d) => d.period),
                              ),
                            ].map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button
                        className="primary-button"
                        disabled={asking || question.trim().length < 3}
                        type="submit"
                      >
                        {asking ? (
                          <RefreshCw size={15} className="spin" />
                        ) : (
                          <ArrowUpRight size={16} />
                        )}
                        <span>
                          {asking ? "Reading sources…" : "Investigate"}
                        </span>
                      </button>
                    </div>
                  </form>
                  <div className="suggested-questions">
                    {suggestions.map((q) => (
                      <button
                        key={q}
                        onClick={() =>
                          void ask(q, {
                            ...(type && { type }),
                            ...(period && { period }),
                          })
                        }
                        disabled={asking}
                      >
                        {q}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                  <p className="question-note">
                    <ShieldCheck size={12} />
                    Grounded in retrieved company documents. Evidence gaps stay
                    visible.
                  </p>
                </section>
                <div ref={answerRef}>
                  {asking ? (
                    <div className="answer-loading">
                      <Sparkles size={19} />
                      <strong>Following the evidence…</strong>
                      <p>
                        Retrieving relevant passages and checking source
                        references.
                      </p>
                      <Skeleton rows={2} />
                    </div>
                  ) : (
                    answer && <ResearchAnswer answer={answer} />
                  )}
                </div>
                <section className="price-panel">
                  <div className="section-heading">
                    <div>
                      <h3>The market context</h3>
                      <p className="muted">
                        {mode === "historical"
                          ? "March–April 2025 · historical sessions"
                          : "Latest retrieved completed sessions"}{" "}
                        · Yahoo Finance
                      </p>
                    </div>
                    <div className="segmented small">
                      {["price", "volume"].map((t) => (
                        <button
                          key={t}
                          className={chartType === t ? "selected" : ""}
                          onClick={() => setChartType(t)}
                        >
                          {t === "price" ? "Price" : "Volume"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {overview.points.length ? (
                    <div className="chart-area">
                      <ResponsiveContainer width="100%" height={220}>
                        {chartType === "price" ? (
                          <AreaChart
                            data={overview.points}
                            margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
                          >
                            <CartesianGrid
                              stroke="#263231"
                              strokeDasharray="3 5"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(d) => d.slice(5)}
                              tick={{ fill: "#7f908a", fontSize: 10 }}
                              minTickGap={45}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              domain={["auto", "auto"]}
                              tick={{ fill: "#7f908a", fontSize: 10 }}
                              width={58}
                              tickFormatter={(v) => `₹${Math.round(v)}`}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "#19221f",
                                border: "1px solid #34413b",
                                borderRadius: 6,
                                color: "#ebece3",
                              }}
                              labelFormatter={(label) => date(String(label))}
                              formatter={(value) => [
                                `₹${num(Number(value))}`,
                                "Adjusted close",
                              ]}
                            />
                            <Area
                              type="linear"
                              dataKey="adjusted_close"
                              stroke="#91b7a2"
                              strokeWidth={2}
                              fill="#91b7a2"
                              fillOpacity={0.09}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        ) : (
                          <BarChart
                            data={overview.points}
                            margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
                          >
                            <CartesianGrid
                              stroke="#263231"
                              strokeDasharray="3 5"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(d) => d.slice(5)}
                              tick={{ fill: "#7f908a", fontSize: 10 }}
                              minTickGap={45}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fill: "#7f908a", fontSize: 10 }}
                              width={58}
                              tickFormatter={(v) =>
                                `${(v / 1000000).toFixed(1)}m`
                              }
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "#19221f",
                                border: "1px solid #34413b",
                                borderRadius: 6,
                              }}
                              formatter={(v) => [
                                num(Number(v), 0),
                                "Shares traded",
                              ]}
                            />
                            <Bar
                              dataKey="volume"
                              fill="#9ca991"
                              radius={[2, 2, 0, 0]}
                              isAnimationActive={false}
                            />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty
                      title="No prices stored for this mode."
                      icon={BarChart3}
                    >
                      Use the refresh button to retrieve completed sessions in
                      live mode. No chart points are manufactured.
                    </Empty>
                  )}
                  <p className="table-note">
                    Prices in ₹. The price series uses adjusted closes
                    consistently; it may differ from the daily close in your
                    watchlist.
                  </p>
                </section>
              </div>
              <aside className="research-rail">
                <section className="snapshot-panel">
                  <div className="section-heading">
                    <h3>Financial snapshot</h3>
                    <FileText size={15} />
                  </div>
                  <label>
                    <span className="sr-only">Financial snapshot period</span>
                    <select
                      value={metricPeriod}
                      onChange={(e) => setMetricPeriod(e.target.value)}
                    >
                      {["Q4 FY2025", "FY2025", "Q3 FY2025", "FY2024"].map(
                        (p) => (
                          <option key={p}>{p}</option>
                        ),
                      )}
                    </select>
                  </label>
                  {["Revenue", "EBITDA", "PBT", "PAT"].map((name) => {
                    const m = activeMetrics.find((m) => m.name === name);
                    const doc = overview.documents.find(
                      (d) => d.id === m?.document_id,
                    );
                    return (
                      <div className="snapshot-metric" key={name}>
                        <span>{name}</span>
                        <strong>
                          {m?.value == null ? (
                            <small>Not reported</small>
                          ) : (
                            `₹${num(m.value, 0)}`
                          )}
                        </strong>
                        {m && doc && (
                          <SourceLink url={doc.url} page={m.page}>
                            PDF p.{m.page}
                          </SourceLink>
                        )}
                      </div>
                    );
                  })}
                  <p>
                    ₹ crore ·{" "}
                    {activeMetrics[0]?.basis ??
                      "No validated extraction for this period"}
                  </p>
                </section>
                {!!overview.guidance.length && (
                  <div className="research-guidance">
                    <Target size={20} />
                    <h3>Did management deliver?</h3>
                    <p>{overview.guidance[0].explanation}</p>
                    <button
                      onClick={() =>
                        void ask(
                          "Did management deliver on its FY2025 revenue guidance?",
                        )
                      }
                      disabled={asking}
                    >
                      Inspect the source passages <ArrowUpRight size={13} />
                    </button>
                  </div>
                )}
                <div className="document-library">
                  <div className="section-heading">
                    <h3>Source library</h3>
                    <span className="count-pill">
                      {overview.documents.length}
                    </span>
                  </div>
                  {overview.documents.map((d) => (
                    <div key={d.id}>
                      <FileText size={16} />
                      <div>
                        <strong>{d.type.replaceAll("_", " ")}</strong>
                        <span>{d.period}</span>
                        <span>Indexed {date(d.retrieved_at)}</span>
                        <SourceLink url={d.url}>
                          Open primary document
                        </SourceLink>
                      </div>
                    </div>
                  ))}
                  {!overview.documents.length && (
                    <p>
                      No cached documents. Ask a question to initiate
                      primary-source discovery for this ticker.
                    </p>
                  )}
                  <p className="library-note">
                    PDF page numbers refer to the actual file, including cover
                    pages. Large annual reports have a bounded selection of
                    indexed pages.
                  </p>
                </div>
              </aside>
            </div>
          </>
        )
      )}
    </>
  );
}

export function ResearchAnswer({ answer }: { answer: Research }) {
  return (
    <section className="research-answer">
      <div className="answer-heading">
        <span>
          <Sparkles size={16} />
          The evidence brief
        </span>
        <span className="badge neutral">{answer.confidence} coverage</span>
      </div>
      <p className="answer-summary">{answer.summary}</p>
      <div className="answer-engine">
        <span className="status-dot" />
        {answer.engine}
        {answer.cached && <span> · cached result</span>}
      </div>
      {answer.key_findings.map((finding, i) => (
        <details
          className="finding"
          key={`${answer.question}-${i}`}
          open={i === 0}
        >
          <summary>
            <span className="finding-index">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>
                {answer.source_references.find(
                  (s) => s.id === finding.source_ids[0],
                )?.title ?? "Source-grounded finding"}
              </strong>
              <span>
                {finding.source_ids
                  .map((id) => {
                    const s = answer.source_references.find((s) => s.id === id);
                    return s ? `${id} · PDF p.${s.page} · ${s.period}` : id;
                  })
                  .join(" / ")}
              </span>
            </div>
            <ChevronDown size={14} />
          </summary>
          <div className="finding-body">
            <div
              className={
                finding.excerpt || answer.engine.startsWith("Source retrieval")
                  ? "source-excerpt"
                  : ""
              }
            >
              {finding.text}
            </div>
            <div className="finding-links">
              {finding.source_ids.map((id) => {
                const source = answer.source_references.find(
                  (s) => s.id === id,
                );
                return source ? (
                  <SourceLink key={id} url={source.url}>
                    {id} · Inspect original PDF page {source.page}
                  </SourceLink>
                ) : null;
              })}
            </div>
          </div>
        </details>
      ))}
      <details className="limitations">
        <summary>
          <Info size={14} />
          Evidence limitations <ChevronDown size={13} />
        </summary>
        <ul>
          {answer.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
