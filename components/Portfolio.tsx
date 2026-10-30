"use client";

import type { Company } from "@/lib/types";
import {
  ArrowUpRight,
  Check,
  Info,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  api,
  date,
  Empty,
  ErrorBox,
  Modal,
  num,
  pct,
  short,
  Skeleton,
  TickerIcon,
} from "./common";
export function CompanySearch({
  intent,
  companies,
  onClose,
  onResearch,
  onAdded,
}: {
  intent: "research" | "portfolio";
  companies: Company[];
  onClose: () => void;
  onResearch: (t: string) => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Company[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [adding, setAdding] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError("");
        api<{ companies: Company[] }>(
          `companies/search?q=${encodeURIComponent(query)}`,
          { signal: abort.signal },
        )
          .then((r) => setResults(r.companies))
          .catch((e) => {
            if (e.name !== "AbortError") {
              setResults([]);
              setError(e.message);
            }
          })
          .finally(() => {
            if (!abort.signal.aborted) setLoading(false);
          });
      },
      query ? 400 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);
  async function add(ticker: string) {
    setAdding(ticker);
    try {
      await api("portfolio", {
        method: "POST",
        body: JSON.stringify({ ticker }),
      });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding("");
    }
  }
  return (
    <Modal
      title={
        intent === "portfolio"
          ? "Build your watchlist"
          : "Follow your curiosity"
      }
      onClose={onClose}
    >
      <p className="muted">
        Search the company library or enter any NSE ticker. Research works
        independently of your portfolio.
      </p>
      <form className="search-input-wrap" onSubmit={(e) => e.preventDefault()}>
        <Search size={20} />
        <input
          autoFocus
          placeholder="Company name or NSE ticker…"
          aria-label="Search companies"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <RefreshCw className="spin" size={16} />}
      </form>
      <div className="quick-tickers">
        {["ASIANPAINT", "PERSISTENT", "DMART"].map((t) => (
          <button key={t} onClick={() => setQuery(t)}>
            {t}
            <ArrowUpRight size={11} />
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      <div className="search-results">
        {loading && !results.length ? (
          <Skeleton rows={2} />
        ) : (
          results.map((c) => {
            const exists = companies.some((p) => p.ticker === c.ticker);
            return (
              <div className="search-result" key={c.ticker}>
                <TickerIcon ticker={c.ticker} />
                <button
                  className="company-result-name"
                  onClick={() => onResearch(c.ticker)}
                >
                  <strong>{c.name}</strong>
                  <span>
                    {c.ticker} · {c.sector}
                  </span>
                </button>
                {intent === "portfolio" ? (
                  <button
                    className={`small-button ${exists ? "added" : ""}`}
                    disabled={exists || !!adding}
                    onClick={() => add(c.ticker)}
                  >
                    {exists ? (
                      <Check size={14} />
                    ) : adding === c.ticker ? (
                      <RefreshCw className="spin" size={14} />
                    ) : (
                      <Plus size={14} />
                    )}{" "}
                    {exists ? "Added" : "Add"}
                  </button>
                ) : (
                  <button
                    className="icon-button"
                    onClick={() => onResearch(c.ticker)}
                    aria-label={`Research ${c.name}`}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="search-footnote">
        <ShieldCheck size={14} />
        Uncached tickers are validated with the market provider, then primary
        documents are discovered on demand.
      </p>
    </Modal>
  );
}

export function Portfolio({
  companies,
  loading,
  mode,
  onAdd,
  onResearch,
  onChange,
  notify,
}: {
  companies: Company[];
  loading: boolean;
  mode: string;
  onAdd: () => void;
  onResearch: (t: string) => void;
  onChange: () => void;
  notify: (m: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function remove(ticker: string) {
    setBusy(ticker);
    try {
      await api(`portfolio/${encodeURIComponent(ticker)}`, {
        method: "DELETE",
      });
      onChange();
      notify(`${short(ticker)} removed from your portfolio.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const filtered = companies.filter((c) =>
    (c.name + c.ticker + c.sector).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">THE COMPANIES YOU FOLLOW</div>
          <h1>
            Your portfolio.
            <br />
            <em>One considered view.</em>
          </h1>
          <p>
            A watchlist for intelligence, with daily closing prices and source
            freshness.
          </p>
        </div>
        <button className="primary-button" onClick={onAdd}>
          <Plus size={17} /> Add company
        </button>
      </div>
      <div className="portfolio-overview">
        <div>
          <strong>{companies.length}</strong>
          <span>companies followed</span>
        </div>
        <div>
          <strong>{new Set(companies.map((c) => c.sector)).size}</strong>
          <span>sectors represented</span>
        </div>
        <div>
          <strong>
            {companies.filter((c) => c.change !== null && c.change > 0).length}
            <small>
              {" "}
              /{" "}
              {
                companies.filter((c) => c.change !== null && c.change < 0)
                  .length
              }
            </small>
          </strong>
          <span>advancers / decliners</span>
        </div>
        <div>
          <strong>{mode === "historical" ? "22 Apr ’25" : "EOD"}</strong>
          <span>
            {mode === "historical"
              ? "historical observation date"
              : "latest stored completed session"}
          </span>
        </div>
      </div>
      <div className="section-heading">
        <h2>
          My watchlist <span className="count-pill">{companies.length}</span>
        </h2>
        <label className="inline-search">
          <Search size={15} />
          <input
            placeholder="Filter your companies"
            aria-label="Filter portfolio"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="holdings-table">
        <div className="holdings-header">
          <span>COMPANY</span>
          <span>DAILY CLOSE</span>
          <span>DAY CHANGE</span>
          <span>REL. VOLUME</span>
          <span>SIGNALS</span>
          <span />
        </div>
        {loading ? (
          <Skeleton rows={5} />
        ) : !filtered.length ? (
          <Empty title="No matching companies.">
            Add a company or change your filter.
          </Empty>
        ) : (
          filtered.map((c) => (
            <div className="holding-row" key={c.ticker}>
              <button
                className="holding-company"
                onClick={() => onResearch(c.ticker)}
              >
                <TickerIcon ticker={c.ticker} />
                <div>
                  <strong>{c.name}</strong>
                  <span>
                    {short(c.ticker)} <i>· {c.sector}</i>
                  </span>
                </div>
              </button>
              <div className="holding-price mono">
                <strong>
                  {c.close === null ? "Unavailable" : `₹${num(c.close)}`}
                </strong>
                <span
                  title={`Data retrieved ${c.updated_at ?? "not recorded"}`}
                >
                  {c.date ? date(c.date) : "Fetch in live research"}
                </span>
              </div>
              <span
                className={`holding-change mono ${(c.change ?? 0) < 0 ? "negative" : "positive"}`}
              >
                {pct(c.change)}
              </span>
              <span
                className={`holding-volume mono ${(c.relative_volume ?? 0) >= 2 ? "amber-text" : ""}`}
              >
                {c.relative_volume == null
                  ? "—"
                  : `${c.relative_volume.toFixed(2)}×`}
              </span>
              <button
                className="holding-events"
                onClick={() => onResearch(c.ticker)}
                aria-label={`Research ${c.ticker}`}
              >
                {c.events ? (
                  <span className="event-count">
                    {c.events} signal{c.events > 1 ? "s" : ""}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </button>
              <button
                className="remove-button icon-button"
                disabled={busy === c.ticker}
                onClick={() => remove(c.ticker)}
                aria-label={`Remove ${c.name}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>
      <p className="coverage-note">
        <Info size={13} />
        Daily close is the provider’s stored close; percentage change uses its
        adjusted series. Relative volume compares with prior sessions, excluding
        the observed day. This watchlist contains no position sizes or portfolio
        returns.
      </p>
    </>
  );
}
