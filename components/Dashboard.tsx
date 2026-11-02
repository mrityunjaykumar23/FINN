"use client";

import type { Company, RankedFiling } from "@/lib/types";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Info,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AlertSettings } from "./AlertSettings";
import { Briefing } from "./Briefing";
import {
  api,
  date,
  ErrorBox,
  Logo,
  navigation,
  View,
  Skeleton,
} from "./common";
import { EventDetail } from "./Evidence";
import { CompanySearch, Portfolio } from "./Portfolio";
import { PromiseTracker } from "./PromiseTracker";
import { ResearchView } from "./Research";
import { SourceDiscipline } from "./SourceDiscipline";
import { FinnMark } from "./Brand";
export default function Dashboard() {
  const [view, setView] = useState<View>("today"),
    [mode, setMode] = useState("live"),
    [modeReady, setModeReady] = useState(false),
    [marketRevision, setMarketRevision] = useState(0),
    [companies, setCompanies] = useState<Company[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [search, setSearch] = useState<"research" | "portfolio" | null>(null),
    [ticker, setTicker] = useState("INFY.NS"),
    [event, setEvent] = useState<RankedFiling | null>(null),
    [toast, setToast] = useState(""),
    [revision, setRevision] = useState(0),
    [question, setQuestion] = useState("");
  const forceMarket = useRef(false);
  useEffect(() => {
    let stored = "live";
    try {
      stored =
        localStorage.getItem("finn.market-mode.v1") === "historical"
          ? "historical"
          : "live";
    } catch {}
    queueMicrotask(() => {
      setMode(stored);
      setModeReady(true);
    });
  }, []);
  const selectMode = (next: string) => {
    if (next !== mode) {
      setCompanies([]);
      setLoading(true);
    }
    setMode(next);
    try {
      localStorage.setItem("finn.market-mode.v1", next);
    } catch {}
  };
  const [showSources, setShowSources] = useState(false);
  const notify = useCallback((message: string) => {
    setToast(message);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!modeReady) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    api<{ companies: Company[] }>(`portfolio?mode=${mode}`)
      .then((d) => {
        if (active) {
          setCompanies(d.companies);
          setError("");
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
  }, [revision, mode, modeReady]);
  useEffect(() => {
    if (!modeReady || mode !== "live") return;
    const controller = new AbortController(),
      signal = controller.signal,
      force = forceMarket.current;
    forceMarket.current = false;
    void (async () => {
      for (let batch = 0; batch < 10; batch++) {
        const work = await api<{
          queued: string[];
          pending: number;
          running: number;
          limited: boolean;
        }>("portfolio/refresh-market", {
          method: "POST",
          body: JSON.stringify({ force }),
          signal,
        });
        if (!work.queued.length && !work.running) break;
        for (let poll = 0; poll < 15; poll++) {
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
          const result = await api<{ companies: Company[] }>(
            "portfolio?mode=live",
            { signal },
          );
          setCompanies(result.companies);
          if (!result.companies.some((c) => c.market_freshness?.refreshing))
            break;
        }
        if (!work.pending || work.limited) break;
      }
    })().catch(() => {
      /* Per-company source state and retry controls remain visible. */
    });
    return () => controller.abort();
  }, [revision, mode, modeReady, marketRevision]);
  const latestSession = companies
    .map((c) => c.date)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const refreshMarket = () => {
    notify(
      "Checking market sources. Recent checks use the five-minute retry cooldown.",
    );
    forceMarket.current = true;
    setMarketRevision((r) => r + 1);
  };
  const researchCompany = (symbol: string, q = "") => {
    setTicker(symbol);
    setQuestion(q);
    setView("research");
    setEvent(null);
    setSearch(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const navigate = (id: View) => {
    setView(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const refreshPortfolio = () => setRevision((r) => r + 1);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Logo />
        <div className="brand-caption">Financial Investment Agent</div>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            <FinnMark />
          </span>
          <div>
            <strong>My investment desk</strong>
            <span>Anonymous workspace</span>
          </div>
        </div>
        <div className="nav-caption">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>Evidence before opinion.</strong>
          <p>
            Every insight starts with a company disclosure. Every source is
            yours to inspect.
          </p>
          <button onClick={() => setShowSources(true)}>
            Our source discipline <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          <div>
            <strong>
              {mode === "historical"
                ? "Verified historical demo"
                : "Live retrieval mode"}
            </strong>
            <span>End-of-day intelligence</span>
          </div>
          <button
            className="icon-button"
            onClick={() => setShowSources(true)}
            aria-label="Data coverage information"
          >
            <Info size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Logo />
          </div>
          <div className="breadcrumb">
            My investment desk <ChevronRight size={13} />
            <span>{navigation.find((n) => n.id === view)?.label}</span>
          </div>
          <span className="header-mode">
            <span className="status-dot" />
            {mode === "historical"
              ? "Replay · Apr 2025"
              : latestSession
                ? `Latest · ${new Date(latestSession + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                : "Latest EOD"}
          </span>
          <button
            className="global-search"
            aria-label="Research any NSE company"
            onClick={() => setSearch("research")}
          >
            <Search size={16} />
            <span>Research any NSE company</span>
            <span className="search-hint">
              Explore <ArrowUpRight size={11} />
            </span>
          </button>
          <button
            className="top-alert icon-button"
            onClick={() => navigate("settings")}
            aria-label="Alert settings"
          >
            <Bell size={19} />
          </button>
          <span className="user-avatar" aria-label="Personal workspace">
            <FinnMark />
          </span>
        </header>
        <main id="main-content" className={`content view-${view}`}>
          <div className="mode-banner">
            <span>
              <span className={`status-dot ${mode === "live" ? "live" : ""}`} />
              {mode === "historical" ? (
                <>
                  <strong>Historical replay</strong>
                  <span className="banner-detail">
                    {" "}
                    · April 2025 disclosures & daily closes. Original dates,
                    real sources.
                  </span>
                </>
              ) : (
                <>
                  <strong>Latest EOD</strong>
                  <span className="banner-detail">
                    {" "}
                    ·{" "}
                    {latestSession
                      ? `Latest verified session ${date(latestSession)}. Each company retains its own observation date.`
                      : "Checking available completed NSE sessions. No historical substitution."}
                  </span>
                </>
              )}
            </span>
            <button
              onClick={() => {
                selectMode(mode === "historical" ? "live" : "historical");
                notify(
                  mode === "historical"
                    ? "Latest EOD selected. Missing or stale observations are checked automatically."
                    : "Historical replay selected.",
                );
              }}
            >
              {mode === "historical" ? "Latest EOD" : "Historical Replay"}
              <ArrowRight size={12} />
            </button>
          </div>
          {error && <ErrorBox message={error} retry={refreshPortfolio} />}
          {loading && (
            <div role="status">
              <p className="muted">Loading your saved portfolio…</p>
              <Skeleton rows={3} />
            </div>
          )}
          {!loading && !error && view === "today" && (
            <Briefing
              companies={companies}
              mode={mode}
              revision={revision}
              onEvent={setEvent}
              onResearch={researchCompany}
              onView={navigate}
              onSources={() => setShowSources(true)}
            />
          )}
          {view === "portfolio" && (
            <Portfolio
              companies={companies}
              loading={loading}
              mode={mode}
              onAdd={() => setSearch("portfolio")}
              onResearch={researchCompany}
              onChange={refreshPortfolio}
              onRefreshMarket={refreshMarket}
              notify={notify}
            />
          )}
          {view === "research" && (
            <ResearchView
              ticker={ticker}
              initialQuestion={question}
              companies={companies}
              mode={mode}
              onSearch={() => setSearch("research")}
              onCompany={researchCompany}
              notify={notify}
              onPortfolioChange={refreshPortfolio}
            />
          )}
          {view === "promises" && (
            <PromiseTracker onResearch={researchCompany} />
          )}
          {view === "settings" && (
            <AlertSettings
              companies={companies}
              onSave={() => {
                refreshPortfolio();
                notify(
                  "Alert rules saved. Portfolio signals will use your new thresholds.",
                );
              }}
            />
          )}
          <footer className="page-footer">
            <Logo />
            <span>Signal over noise.</span>
            <button onClick={() => setShowSources(true)}>
              Data & methodology <ArrowUpRight size={11} />
            </button>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => navigate(id)}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span>
              {id === "today"
                ? "Briefing"
                : id === "promises"
                  ? "Promises"
                  : id === "settings"
                    ? "Alerts"
                    : label}
            </span>
          </button>
        ))}
      </nav>
      {search && (
        <CompanySearch
          intent={search}
          companies={companies}
          onClose={() => setSearch(null)}
          onResearch={researchCompany}
          onAdded={() => {
            refreshPortfolio();
            notify("Company added to your portfolio.");
          }}
        />
      )}
      {event && (
        <EventDetail
          event={event}
          onClose={() => setEvent(null)}
          onResearch={researchCompany}
        />
      )}
      {showSources && (
        <SourceDiscipline onClose={() => setShowSources(false)} />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
