import { selectMetric } from "./periods.ts";
import { headlineMetrics } from "./financial-definitions.ts";
import type { Metric } from "./domain.ts";
export type MetricProgress = {
  name: string;
  period: string;
  basis: string;
  state: string;
  error_code: string | null;
  detail: string | null;
  updated_at: string;
};
export type SnapshotSource = {
  id: string;
  status: string;
  document_id: string | null;
  error: string | null;
  error_code?: string | null;
  failed_stage?: string | null;
  url: string;
};
/** Download failures describe sources. Only an actual metric attempt can fail that metric. */
export function snapshotMetricStates(input: {
  metrics: Metric[];
  period: string | null;
  basis: string;
  job: { status: string; phase: string } | null;
  sources: SnapshotSource[];
  progress: MetricProgress[];
  financialSector?: boolean;
}) {
  const active =
    !!input.job && ["queued", "running"].includes(input.job.status);
  const rows = input.metrics.filter((m) =>
    new RegExp(input.basis, "i").test(m.basis),
  );
  const statuses = headlineMetrics.map((name) => {
    const metric = selectMetric(rows, name, input.period ?? undefined);
    if (metric)
      return {
        name,
        state: "Verified",
        metric,
        error_code: null,
        detail: null,
      };
    if (name === "EBITDA" && input.financialSector)
      return {
        name,
        state: "Not applicable",
        metric: null,
        error_code: null,
        detail:
          "EBITDA is not used as a headline banking or financial-company measure.",
      };
    const progress = input.progress
      .filter(
        (p) =>
          p.name === name &&
          (!input.period ||
            p.period === input.period ||
            p.period === "unknown" ||
            p.period === "Period not verified") &&
          (!p.basis || new RegExp(input.basis, "i").test(p.basis)),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const attemptedFailure = progress.find(
      (p) => p.state === "Extraction failed",
    );
    const pending = progress.find((p) =>
      ["Extracting", "Extracted, awaiting validation"].includes(p.state),
    );
    const checked = progress.find((p) =>
      ["Insufficient evidence", "Not disclosed in checked sources"].includes(
        p.state,
      ),
    );
    let state = "Awaiting source discovery",
      error_code: string | null = null,
      detail: string | null = null;
    if (active && pending) {
      state = pending.state;
    } else if (attemptedFailure) {
      state = "Extraction failed";
      error_code = attemptedFailure.error_code;
      detail = attemptedFailure.detail;
    } else if (checked) {
      state = checked.state;
      error_code = checked.error_code;
      detail = checked.detail;
    } else if (progress.some((p) => p.state === "Verified")) {
      state = "Insufficient evidence";
      detail =
        "Conflicting or incompatible accepted source facts require review.";
    } else if (input.sources.some((s) => !!s.document_id)) {
      state = active ? "Extraction queued" : "Source found";
    } else if (input.sources.length) {
      state = "Source found";
      detail =
        "An original source was identified; its download/indexing status is shown separately.";
    }
    return { name, state, metric: null, error_code, detail };
  });
  const verified = statuses.filter((s) => s.state === "Verified").length;
  const required = statuses.filter(
    (s) => s.name !== "EBITDA" && s.state !== "Not applicable",
  );
  const readiness = active
    ? "preparing"
    : required.every((s) => s.state === "Verified")
      ? "ready"
      : verified
        ? "partial"
        : input.sources.some((s) => !!s.document_id)
          ? "needs_extraction"
          : "needs_sources";
  return { statuses, readiness, active };
}
