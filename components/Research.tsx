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
  FileText,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
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

import { SystemStatus } from "./SystemStatus";
import { ResearchAnswer } from "./ResearchReport";
import { FinnAvatar } from "./Brand";
import { FinancialSnapshot } from "./FinancialSnapshot";
type ResearchJobState = {
  id: string;
  ticker: string;
  status: string;
  phase: string;
  detail: string | null;
  error: string | null;
  updated_at: string;
  result: Research | null;
};
async function pause(signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
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
}
type Overview = {
  market_freshness?: {
    status: string;
    last_success: string | null;
    last_attempt: string | null;
    details: string;
    error?: string;
    refreshing?: boolean;
  };
  company: Company;
  metrics: Metric[];
  documents: Omit<Document, "pages">[];
  points: {
    date: string;
    close: number;
    adjusted_close: number | null;
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
    [chartType, setChartType] = useState("price");
  const answerRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const [job, setJob] = useState<ResearchJobState | null>(null);
  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [ticker, mode],
  );
  const ask = useCallback(
    async (q: string, filters: { type?: string; period?: string } = {}) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setAsking(true);
      setJob(null);
      setAnswer(null);
      setError("");
      setQuestion(q);
      try {
        let state = await api<ResearchJobState>("research/jobs", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ ticker, question: q, ...filters }),
        });
        for (let poll = 0; poll < 150; poll++) {
          if (controller.signal.aborted) return;
          setJob(state);
          if (state.status === "complete" && state.result) {
            setAnswer(state.result);
            break;
          }
          if (state.status === "failed")
            throw new Error(
              state.error ?? "Research preparation needs source review.",
            );
          if (
            state.status === "queued" ||
            Date.now() - Date.parse(state.updated_at) > 90000
          ) {
            state = await api<ResearchJobState>(
              `research/jobs/${state.id}/advance`,
              { method: "POST", body: "{}", signal: controller.signal },
            );
            setJob(state);
          }
          await pause(controller.signal);
          state = await api<ResearchJobState>(`research/jobs/${state.id}`, {
            signal: controller.signal,
          });
          if (poll === 149)
            throw new Error(
              "Research is still queued. Its saved status will be resumed when you investigate this question again.",
            );
        }
        if (controller.signal.aborted) return;
        const updated = await api<Overview>(
          `companies/${encodeURIComponent(ticker)}/overview?mode=${mode}`,
          { signal: controller.signal },
        );
        setOverview(updated);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (activeRequest.current === controller) setAsking(false);
      }
    },
    [ticker, mode],
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setLoading(true);
        setAnswer(null);
        setOverview(null);
        setError("");
      }
    });
    queueMicrotask(() => {
      if (active) {
        setQuestion(initialQuestion);
        setType("");
        setPeriod("");
      }
    });
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
  useEffect(() => {
    if (mode !== "live") return;
    const controller = new AbortController(),
      signal = controller.signal;
    void (async () => {
      await api(`companies/${encodeURIComponent(ticker)}/refresh-market`, {
        method: "POST",
        body: "{}",
        signal,
      });
      for (let i = 0; i < 15; i++) {
        const updated = await api<Overview>(
          `companies/${encodeURIComponent(ticker)}/overview?mode=live`,
          { signal },
        );
        setOverview(updated);
        if (!updated.market_freshness?.refreshing) break;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", cancel);
            resolve();
          }, 1500);
          const cancel = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal.addEventListener("abort", cancel, { once: true });
        });
      }
    })().catch(() => {
      /* Existing market freshness/error and retry button remain available. */
    });
    return () => controller.abort();
  }, [ticker, mode]);
  const financialPrepared = useCallback(
    async (signal: AbortSignal) => {
      const updated = await api<Overview>(
        `companies/${encodeURIComponent(ticker)}/overview?mode=${mode}`,
        { signal },
      );
      if (!signal.aborted) setOverview(updated);
    },
    [ticker, mode],
  );
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
  async function refreshSources() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ limitations: string[]; status?: string }>(
        "companies/refresh-documents",
        { method: "POST", body: JSON.stringify({ ticker }) },
      );
      setOverview(
        await api<Overview>(
          `companies/${encodeURIComponent(ticker)}/overview?mode=${mode}`,
        ),
      );
      notify(
        result.limitations.length
          ? result.limitations.join(" ")
          : "Primary source library checked. Inspect indexing coverage below.",
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
    "Explain profitability trends using comparable quarters.",
  ];
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">FINN RESEARCH WORKSPACE</div>
          <h1>Research with conviction.</h1>
          <p>
            Ask a better question. Follow it back to the company’s own words.
          </p>
        </div>
        <button className="secondary-button" onClick={onSearch}>
          <Search size={16} />
          Find a company
        </button>
      </div>
      <SystemStatus compact />
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
                  <div className="research-identity">
                    <FinnAvatar />
                    <div>
                      <h3>FINN Research.</h3>
                      <p>What would you like to understand?</p>
                    </div>
                  </div>
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
                    <div
                      className="job-progress"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="job-progress-header">
                        <FinnAvatar />
                        <div>
                          <h3>
                            {job
                              ? "Following the evidence"
                              : "Submitting your research request"}
                          </h3>
                          <p>
                            {job?.detail ??
                              "Preparing a saved research request."}
                          </p>
                        </div>
                      </div>
                      <ol>
                        {[
                          ["discovery", "Finding company sources"],
                          ["documents", "Retrieving and indexing originals"],
                          ["extraction", "Extracting relevant financial facts"],
                          ["analysis", "Analysing metrics and source passages"],
                          ["synthesis", "Generating grounded research"],
                        ].map(([phase, label]) => (
                          <li
                            key={phase}
                            className={job?.phase === phase ? "active" : ""}
                          >
                            <span className="phase-dot" />
                            {label}
                            {job?.phase === phase && (
                              <span className="sr-only"> · active</span>
                            )}
                          </li>
                        ))}
                      </ol>
                      <p className="table-note">
                        Existing sources are reused. Progress reflects the saved
                        server state.
                      </p>
                    </div>
                  ) : (
                    answer && (
                      <ResearchAnswer
                        answer={answer}
                        documents={overview.documents}
                      />
                    )
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
                              stroke="var(--finn-border)"
                              strokeDasharray="3 5"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(d) => d.slice(5)}
                              tick={{
                                fill: "var(--finn-text-secondary)",
                                fontSize: 12,
                              }}
                              minTickGap={45}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              domain={["auto", "auto"]}
                              tick={{
                                fill: "var(--finn-text-secondary)",
                                fontSize: 12,
                              }}
                              width={58}
                              tickFormatter={(v) => `₹${Math.round(v)}`}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "var(--finn-card)",
                                border: "1px solid var(--finn-border)",
                                borderRadius: 6,
                                color: "var(--finn-text)",
                              }}
                              labelFormatter={(label) => date(String(label))}
                              formatter={(value) => [
                                `₹${num(Number(value))}`,
                                overview.points.some(
                                  (p) => p.adjusted_close === null,
                                )
                                  ? "Daily close (unadjusted)"
                                  : "Adjusted close",
                              ]}
                            />
                            <Area
                              type="linear"
                              dataKey={
                                overview.points.some(
                                  (p) => p.adjusted_close === null,
                                )
                                  ? "close"
                                  : "adjusted_close"
                              }
                              stroke="var(--finn-accent)"
                              strokeWidth={2}
                              fill="var(--finn-accent)"
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
                              stroke="var(--finn-border)"
                              strokeDasharray="3 5"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(d) => d.slice(5)}
                              tick={{
                                fill: "var(--finn-text-secondary)",
                                fontSize: 12,
                              }}
                              minTickGap={45}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{
                                fill: "var(--finn-text-secondary)",
                                fontSize: 12,
                              }}
                              width={58}
                              tickFormatter={(v) =>
                                `${(v / 1000000).toFixed(1)}m`
                              }
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "var(--finn-card)",
                                border: "1px solid var(--finn-border)",
                                borderRadius: 6,
                              }}
                              formatter={(v) => [
                                num(Number(v), 0),
                                "Shares traded",
                              ]}
                            />
                            <Bar
                              dataKey="volume"
                              fill="var(--finn-accent-blue)"
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
                  {overview.points.some((p) => p.adjusted_close === null) && (
                    <p className="muted">
                      Chart shows unadjusted daily closes. Percentage moves
                      remain unavailable when comparable adjusted closes are
                      missing.
                    </p>
                  )}
                  {mode === "live" && (
                    <p className="muted">
                      Latest stored session:{" "}
                      {overview.points.at(-1)?.date ?? "unavailable"} · Last
                      successful market check:{" "}
                      {overview.market_freshness?.last_success
                        ? new Date(
                            overview.market_freshness.last_success,
                          ).toLocaleString()
                        : "never"}{" "}
                      · Source status:{" "}
                      {overview.market_freshness?.status ?? "not checked"}
                      {overview.market_freshness?.error && (
                        <span className="market-error">
                          {" "}
                          · {overview.market_freshness.error} Use the market
                          refresh button to retry.
                        </span>
                      )}
                    </p>
                  )}
                  <p className="table-note">
                    Prices in ₹. Daily change uses comparable adjusted closes.
                    Chart labels identify the plotted series.
                  </p>
                </section>
              </div>
              <aside className="research-rail">
                <FinancialSnapshot
                  key={ticker}
                  ticker={ticker}
                  metrics={overview.metrics}
                  documents={overview.documents}
                  onPrepared={financialPrepared}
                />
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
                    <button
                      className="small-button"
                      disabled={busy || asking}
                      onClick={refreshSources}
                    >
                      <RefreshCw size={13} />{" "}
                      {busy ? "Checking…" : "Refresh sources"}
                    </button>
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
                        {d.extraction_status && (
                          <span>
                            {d.extraction_status} text indexing ·{" "}
                            {d.indexed_pages ?? "?"}/{d.total_pages ?? "?"}{" "}
                            pages · period {d.period_status ?? "unverified"}
                          </span>
                        )}
                        {d.financial_extraction_status && (
                          <span>
                            Financial extraction:{" "}
                            {d.financial_extraction_status.replaceAll("_", " ")}
                            {d.financial_extraction_error
                              ? ` · ${d.financial_extraction_error}`
                              : ""}
                          </span>
                        )}
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

export { ResearchAnswer } from "./ResearchReport";
