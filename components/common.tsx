"use client";

import {
  Activity,
  BriefcaseBusiness,
  CircleAlert,
  ExternalLink,
  FileText,
  Layers3,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export type View = "today" | "portfolio" | "research" | "promises" | "settings";
export const navigation: { id: View; label: string; icon: typeof Activity }[] =
  [
    { id: "today", label: "Your briefing", icon: Layers3 },
    { id: "portfolio", label: "Portfolio", icon: BriefcaseBusiness },
    { id: "research", label: "Research", icon: Sparkles },
    { id: "promises", label: "Promise tracker", icon: Target },
    { id: "settings", label: "Alert rules", icon: SlidersHorizontal },
  ];
export const labels: Record<string, string> = {
  results: "Financial results",
  "M&A": "Mergers & acquisitions",
  fund_raise: "Capital raising",
  management_change: "Management",
  litigation: "Legal & regulatory",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meetings",
  insider_trading: "Insider transactions",
  credit_rating: "Credit ratings",
  dividend: "Dividends",
  bonus_split: "Bonus & splits",
  capex: "Capital expenditure",
  press_release: "Company updates",
  postal_ballot: "Postal ballot",
  agm_egm: "Shareholder meetings",
  pledging: "Promoter pledging",
  unclassified: "Other filings",
};
export const short = (ticker: string) => ticker.replace(/\.(NS|BO)$/, "");
export const num = (n: number | null | undefined, digits = 2) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(n);
export const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
export const date = (
  d: string | null | undefined,
  month: "short" | "long" = "short",
) =>
  d
    ? new Date(
        d + (d.length === 10 ? "T12:00:00+05:30" : ""),
      ).toLocaleDateString("en-IN", {
        day: "numeric",
        month,
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : "Date unavailable";
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const value = (await response.json()) as { error?: { message?: string } };
  if (!response.ok)
    throw new Error(
      value.error?.message ?? "The request could not be completed.",
    );
  return value as T;
}
export function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 30 30">
          <path
            d="M7 22V8h16M7 15h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path d="m16 24 7-7" stroke="currentColor" strokeWidth="3" />
        </svg>
      </span>
      <span>
        finn<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export function TickerIcon({
  ticker,
  small = false,
}: {
  ticker: string;
  small?: boolean;
}) {
  const t = short(ticker);
  return (
    <span
      className={`ticker-icon ${small ? "small" : ""} tone-${t.charCodeAt(0) % 5}`}
    >
      {t === "HCLTECH" ? "hcl" : t === "INFY" ? "in" : t.slice(0, 2)}
    </span>
  );
}
export function SourceLink({
  url,
  children = "Original source",
  page,
}: {
  url: string;
  children?: ReactNode;
  page?: number;
}) {
  return url ? (
    <a
      href={page ? `${url.split("#")[0]}#page=${page}` : url}
      target="_blank"
      rel="noreferrer"
      className="source-link"
    >
      {children}
      <ExternalLink size={12} />
    </a>
  ) : (
    <span className="muted">Source unavailable</span>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <CircleAlert size={19} />
      <div>
        <strong>Something needs attention</strong>
        <p>{message}</p>
        {retry && (
          <button className="text-button" onClick={retry}>
            Try again <RefreshCw size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      className="skeletons"
      aria-busy="true"
      aria-label="Loading intelligence"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton" key={i}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
export function Empty({
  title,
  children,
  icon: Icon = FileText,
}: {
  title: string;
  children: ReactNode;
  icon?: typeof FileText;
}) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
