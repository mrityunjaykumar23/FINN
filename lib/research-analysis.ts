import {
  compareGuidance,
  percentChange,
  ratio,
  type Metric,
  type Guidance,
} from "./domain.ts";
import { comparisonPeriods, sortPeriods } from "./periods.ts";
export type CalculatedFinding = {
  text: string;
  sources: { document_id: string; page: number }[];
};

/** Only validated metrics with matching periods, units and accounting definitions can combine. */
export function calculateFindings(
  ticker: string,
  question: string,
  metrics: Metric[],
  guidance: Guidance[],
  requestedPeriod?: string,
): CalculatedFinding[] {
  const q = question.toLowerCase(),
    rows = metrics.filter(
      (m) => m.ticker === ticker && m.verification_status !== "unverified",
    ),
    findings: CalculatedFinding[] = [];
  const money = (v: number) =>
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
  const amount = (m: Metric) =>
    m.unit === "INR crore"
      ? `₹${money(m.value!)} crore`
      : `${money(m.value!)} ${m.unit}`;
  const source = (m: Metric) => ({ document_id: m.document_id, page: m.page });
  const comparable = (
    a: Metric | undefined,
    b: Metric | undefined,
    samePeriod = false,
  ): a is Metric =>
    !!a &&
    !!b &&
    a.value !== null &&
    b.value !== null &&
    a.basis === b.basis &&
    a.unit === b.unit &&
    (!samePeriod || a.period === b.period);
  if (/guidance|promise|deliver/.test(q)) {
    const relevant = guidance.filter(
      (g) =>
        g.ticker === ticker &&
        (!requestedPeriod || g.period === requestedPeriod) &&
        (!/margin/.test(q) || g.metric === "Operating margin") &&
        (!/revenue/.test(q) || g.metric === "Revenue growth"),
    );
    for (const g of relevant) {
      const result = compareGuidance(g);
      if (result.variance !== null)
        findings.push({
          text: `${g.period} ${g.metric.toLowerCase()}: ${result.explanation} ${g.qualifier}`,
          sources: [
            { document_id: g.guidance_document, page: g.guidance_page },
            { document_id: g.actual_document, page: g.actual_page },
          ],
        });
    }
  }
  if (/cash|conversion|profitability/.test(q)) {
    const cashPeriod =
      requestedPeriod ??
      sortPeriods(
        rows
          .filter(
            (m) =>
              m.name === "Operating cash flow" || m.name === "Free cash flow",
          )
          .map((m) => m.period),
      ).find((p) => /^FY/.test(p));
    const pat = rows.find((m) => m.name === "PAT" && m.period === cashPeriod),
      ocf = rows.find(
        (m) => m.name === "Operating cash flow" && m.period === cashPeriod,
      ),
      fcf = rows.find(
        (m) => m.name === "Free cash flow" && m.period === cashPeriod,
      );
    const cash = ocf ?? fcf;
    if (
      comparable(cash, pat, true) &&
      cash.value !== null &&
      pat?.value !== null &&
      pat?.value !== undefined &&
      pat.value > 0
    ) {
      const conversion = ratio(cash.value, pat.value)! * 100;
      findings.push({
        text: `${cashPeriod} ${cash.name.toLowerCase()} was ${amount(cash)}, or ${conversion.toFixed(1)}% of attributable PAT of ${amount(pat)}. This is calculated from ${/consolidated/i.test(cash.basis) ? "consolidated" : "standalone"} ${cash.unit.startsWith("INR") ? "INR" : cash.unit} figures; it can differ from a company ratio using another profit definition or currency. One year alone does not establish sustained cash quality.`,
        sources: [source(cash), source(pat)],
      });
    }
    if (
      fcf?.value !== null &&
      fcf?.value !== undefined &&
      ocf &&
      comparable(ocf, fcf, true)
    )
      findings.push({
        text: `FY2025 reported free cash flow was ${amount(fcf)}. Free cash flow is after capital expenditure; inspect the cash-flow statement for working-capital movements.`,
        sources: [source(fcf)],
      });
  }
  if (/revenue|growth/.test(q) && !/guidance|promise|deliver/.test(q)) {
    const annual = /annual|multi.year|full.year/.test(q),
      currentPeriod =
        requestedPeriod ??
        (annual
          ? sortPeriods(
              rows
                .filter((m) => m.name === "Revenue" && /^FY/.test(m.period))
                .map((m) => m.period),
            )[0]
          : comparisonPeriods(rows)[0]);
    const periods = comparisonPeriods(rows, currentPeriod);
    const current = rows.find(
      (m) => m.name === "Revenue" && m.period === currentPeriod,
    );
    const comparisons = annual
      ? [[periods[1], "year on year"]]
      : [
          [periods[1], "quarter on quarter"],
          [periods[2], "year on year"],
        ];
    for (const [period, label] of comparisons) {
      const base = rows.find(
        (m) => m.name === "Revenue" && m.period === period,
      );
      if (comparable(current, base) && current.value !== null && base) {
        const change = percentChange(current.value, base.value);
        if (change.value !== null)
          findings.push({
            text: `${currentPeriod} reported ${current.unit.startsWith("INR") ? "INR " : ""}revenue was ${amount(current)}, ${change.value >= 0 ? "up" : "down"} ${Math.abs(change.value).toFixed(2)}% ${label} from ${amount(base)} in ${period}. This calculation uses ${current.basis}; it is not constant-currency growth.`,
            sources: [source(current), source(base)],
          });
      }
    }
  }
  return findings;
}
