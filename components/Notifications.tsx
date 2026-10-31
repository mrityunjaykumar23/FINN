"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ErrorBox, date } from "./common";
type Notice = {
  id: string;
  ticker: string;
  text: string;
  status: string;
  mode: string;
  observed_at: string;
  event_type: string;
  value: number;
  threshold: number;
};
export function Notifications() {
  const [items, setItems] = useState<Notice[]>([]),
    [filter, setFilter] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api<{ alerts: Notice[] }>(`alerts${filter ? "?status=" + filter : ""}`)
        .then((d) => setItems(d.alerts))
        .catch((e) => setError(e.message)),
    [filter],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function change(id: string, status: string) {
    setBusy(true);
    setError("");
    try {
      await api(`alerts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="notification-panel">
      <summary>
        Notification history ·{" "}
        {items.filter((a) => a.status === "unread").length} unread
      </summary>
      <div className="section-heading">
        <h2>Notification history</h2>
        <select
          aria-label="Notification status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All states</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>
      <p className="muted">
        Stored in this visitor session. Historical replay, current EOD and
        filing alerts are labelled individually. Changes to rules preserve past
        notification history.
      </p>
      {error && <ErrorBox message={error} />}
      {!items.length && (
        <p>
          No notifications in this view. Open a briefing or evaluate stored
          sessions.
        </p>
      )}
      {items.map((a) => (
        <article className={`notice ${a.status}`} key={a.id}>
          <div>
            <strong>
              {a.ticker} · {a.event_type}
            </strong>
            <span className="badge neutral">{a.status}</span>
          </div>
          <small>
            {a.mode === "historical"
              ? "Historical replay"
              : "Current EOD / filing"}{" "}
            · observed {date(a.observed_at)}
          </small>
          <p>{a.text}</p>
          <details>
            <summary>Underlying observation</summary>
            <p>
              Observed value: {a.value} · threshold / priority: {a.threshold}.{" "}
              {a.event_type === "filing"
                ? "Open the matching filing from the briefing to inspect its original source."
                : "Market observations are available on the company research chart."}
            </p>
          </details>
          <div className="notice-actions">
            {a.status !== "read" && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void change(a.id, "read")}
              >
                Mark read
              </button>
            )}
            {a.status !== "unread" && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void change(a.id, "unread")}
              >
                Mark unread
              </button>
            )}
            {a.status !== "dismissed" && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void change(a.id, "dismissed")}
              >
                Dismiss
              </button>
            )}
          </div>
        </article>
      ))}
    </details>
  );
}
