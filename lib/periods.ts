import { percentChange, type Metric } from "./domain.ts";
export function fiscalPeriod(period: string) {
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
  a.verification_status !== "unverified" &&
  b.verification_status !== "unverified";
export function quarterlyComparisons(rows: Metric[], requested?: string) {
  const periods = comparisonPeriods(rows, requested);
  return ["Revenue", "EBITDA", "PBT", "PAT"].map((name) => {
    const preferred = [...rows].sort(
      (a, b) =>
        Number(/consolidated/i.test(b.basis)) -
        Number(/consolidated/i.test(a.basis)),
    );
    const current = preferred.find(
      (m) => m.name === name && m.period === periods[0] && m.value !== null,
    );
    const values = periods.map((period) =>
      preferred.find(
        (m) =>
          m.name === name &&
          m.period === period &&
          (!current || compatibleMetrics(current, m)),
      ),
    );
    return {
      name,
      periods,
      values,
      qoq: compatibleMetrics(values[0], values[1])
        ? percentChange(values[0]!.value, values[1]!.value).value
        : null,
      yoy: compatibleMetrics(values[0], values[2])
        ? percentChange(values[0]!.value, values[2]!.value).value
        : null,
    };
  });
}
