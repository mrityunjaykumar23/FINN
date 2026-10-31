"use client";
import { useEffect, useState } from "react";
import { api } from "./common";
type Status = {
  ai: { enabled: boolean; provider: string; model: string | null };
  counts: {
    companies: number;
    documents: number;
    chunks: number;
    announcements: number;
    metrics: number;
    guidance: number;
  };
  sync: {
    provider: string;
    ticker: string;
    last_success: string | null;
    status: string;
    error: string | null;
  }[];
  coverage_note: string;
};
export function SystemStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Status>("status")
      .then(setStatus)
      .catch(() => setError("System status unavailable."));
  }, []);
  return (
    <details className="system-status" open={!compact}>
      <summary>
        {status
          ? status.ai.enabled
            ? `Gemini configured · ${status.ai.model}`
            : "Extractive / offline mode · Gemini not configured"
          : error || "Checking source and AI status…"}
      </summary>
      {status && (
        <div>
          <p>
            {status.ai.enabled
              ? "Provider is configured. Each research response reports whether Gemini actually succeeded."
              : "Research uses stored primary evidence and deterministic calculations. Add the server-side Gemini key to enable synthesis."}
          </p>
          <p>
            {status.counts.companies} supported companies ·{" "}
            {status.counts.documents} documents · {status.counts.metrics} metric
            records
          </p>
          <p>{status.coverage_note}</p>
          {status.sync.length ? (
            <ul>
              {status.sync.slice(0, 8).map((s) => (
                <li key={s.provider + s.ticker}>
                  {s.ticker} · {s.provider}: {s.status} · last success{" "}
                  {s.last_success ?? "not yet established"}
                  {s.error && ` · ${s.error}`}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No dynamic source checks recorded yet. The historical library is
              available.
            </p>
          )}
        </div>
      )}
    </details>
  );
}
