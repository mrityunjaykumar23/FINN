import { percentChange, type Metric } from "./domain.ts";
export function fiscalPeriod(period: string) {
  const half = period.match(/^H([12])\s+FY(\d{4})$/);
  if (half)
    return {
      year: Number(half[2]),
      quarter: null,
      ordinal: Number(half[2]) * 4 + Number(half[1]) * 2 - 0.25,
    };
  const m = period.match(/^(?:Q([1-4])\s+)?FY(\d{4})$/);
  return m
    ? {
        year: Number(m[2]),
        quarter: m[1] ? Number(m[1]) : null,
        ordinal: Number(m[2]) * 4 + Number(m[1] ?? 4),
      }
    : null;
}
export const sortPeriods = (periods: string[]) =>
  [...new Set(periods)]
    .filter((p) => fiscalPeriod(p))
    .sort(
      (a, b) =>
        fiscalPeriod(b)!.ordinal - fiscalPeriod(a)!.ordinal ||
        a.localeCompare(b),
    );
export function comparisonPeriods(rows: Metric[], requested?: string) {
  const available = sortPeriods(
    rows
      .filter((m) => m.value !== null && m.verification_status !== "unverified")
      .map((m) => m.period),
  );
  const current =
    requested ?? available.find((p) => fiscalPeriod(p)!.quarter !== null);
  const p = current ? fiscalPeriod(current) : null;
  if (!p) return [];
  if (/^H[12]/.test(current!))
    return [current!, current!.replace(/FY\d{4}$/, `FY${p.year - 1}`)];
  return p.quarter
    ? [
        current!,
        `Q${p.quarter === 1 ? 4 : p.quarter - 1} FY${p.quarter === 1 ? p.year - 1 : p.year}`,
        `Q${p.quarter} FY${p.year - 1}`,
      ]
    : [current!, `FY${p.year - 1}`];
}
export const compatibleMetrics = (
  a: Metric | undefined,
  b: Metric | undefined,
) =>
  !!a &&
  !!b &&
  a.basis === b.basis &&
  a.unit === b.unit &&
  a.ticker === b.ticker &&
  (a.currency ?? a.unit.match(/^(INR|USD)/)?.[0]) ===
    (b.currency ?? b.unit.match(/^(INR|USD)/)?.[0]) &&
  (a.scale ?? a.unit.match(/crore|million|billion|lakh/)?.[0]) ===
    (b.scale ?? b.unit.match(/crore|million|billion|lakh/)?.[0]) &&
  a.verification_status !== "unverified" &&
  b.verification_status !== "unverified";
/** Prefer explicitly restated facts. Conflicting, equally authoritative facts are unavailable.
 * An extraction timestamp alone is never evidence of a financial restatement. */
export function selectMetric(
  rows: Metric[],
  name: string,
  period: string | undefined,
  anchor?: Metric,
) {
  let candidates = rows.filter(
    (m) =>
      m.name === name &&
      m.period === period &&
      m.value !== null &&
      Number.isFinite(m.value) &&
      m.verification_status !== "unverified" &&
      (!anchor || compatibleMetrics(anchor, m)),
  );
  if (!anchor && candidates.some((m) => /consolidated/i.test(m.basis)))
    candidates = candidates.filter((m) => /consolidated/i.test(m.basis));
  const restated = candidates.filter((m) => m.reporting_status === "restated");
  if (restated.length) {
    const latest = restated
      .map((m) => m.published_at ?? "")
      .sort()
      .at(-1);
    candidates = restated.filter((m) => (m.published_at ?? "") === latest);
  }
  const facts = new Set(
    candidates.map((m) =>
      JSON.stringify([
        m.value,
        m.basis,
        m.unit,
        m.currency ?? m.unit.match(/^(INR|USD)/)?.[0] ?? null,
        m.scale ?? m.unit.match(/crore|million|billion|lakh/)?.[0] ?? null,
      ]),
    ),
  );
  return facts.size === 1
    ? candidates.sort((a, b) => a.id.localeCompare(b.id))[0]
    : undefined;
}
export function quarterlyComparisons(rows: Metric[], requested?: string) {
  const periods = comparisonPeriods(rows, requested);
  const isQuarter = !!periods[0]?.startsWith("Q");
  return ["Revenue", "EBITDA", "PBT", "PAT"].map((name) => {
    const current = selectMetric(rows, name, periods[0]);
    const values = periods.map((period, i) =>
      i === 0
        ? current
        : current
          ? selectMetric(rows, name, period, current)
          : undefined,
    );
    return {
      name,
      periods,
      values,
      qoq:
        isQuarter && compatibleMetrics(values[0], values[1])
          ? percentChange(values[0]!.value, values[1]!.value).value
          : null,
      yoy: compatibleMetrics(values[0], values[isQuarter ? 2 : 1])
        ? percentChange(values[0]!.value, values[isQuarter ? 2 : 1]!.value)
            .value
        : null,
    };
  });
}
