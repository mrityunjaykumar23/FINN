import {
  compareGuidance,
  percentChange,
  ratio,
  type Metric,
  type Guidance,
} from "./domain.ts";
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
): CalculatedFinding[] {
  const q = question.toLowerCase(),
    rows = metrics.filter((m) => m.ticker === ticker),
    findings: CalculatedFinding[] = [];
  const money = (v: number) =>
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
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
    const pat = rows.find((m) => m.name === "PAT" && m.period === "FY2025"),
      ocf = rows.find(
        (m) => m.name === "Operating cash flow" && m.period === "FY2025",
      ),
      fcf = rows.find(
        (m) => m.name === "Free cash flow" && m.period === "FY2025",
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
        text: `FY2025 ${cash.name.toLowerCase()} was ₹${money(cash.value)} crore, or ${conversion.toFixed(1)}% of attributable PAT of ₹${money(pat.value)} crore. This is calculated from consolidated INR figures; it can differ from a company ratio using another profit definition or currency. One year alone does not establish sustained cash quality.`,
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
        text: `FY2025 reported free cash flow was ₹${money(fcf.value)} crore. Free cash flow is after capital expenditure; inspect the cash-flow statement for working-capital movements.`,
        sources: [source(fcf)],
      });
  }
  if (/revenue|growth/.test(q) && !/guidance|promise|deliver/.test(q)) {
    const annual = /annual|multi.year|full.year/.test(q),
      currentPeriod = annual ? "FY2025" : "Q4 FY2025";
    const current = rows.find(
      (m) => m.name === "Revenue" && m.period === currentPeriod,
    );
    const comparisons = annual
      ? [["FY2024", "year on year"]]
      : [
          ["Q3 FY2025", "quarter on quarter"],
          ["Q4 FY2024", "year on year"],
        ];
    for (const [period, label] of comparisons) {
      const base = rows.find(
        (m) => m.name === "Revenue" && m.period === period,
      );
      if (comparable(current, base) && current.value !== null && base) {
        const change = percentChange(current.value, base.value);
        if (change.value !== null)
          findings.push({
            text: `${currentPeriod} reported INR revenue was ₹${money(current.value)} crore, ${change.value >= 0 ? "up" : "down"} ${Math.abs(change.value).toFixed(2)}% ${label} from ₹${money(base.value!)} crore in ${period}. This calculation uses ${current.basis}; it is not constant-currency growth.`,
            sources: [source(current), source(base)],
          });
      }
    }
  }
  return findings;
}
