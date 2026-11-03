import { financialAnalysis } from "./financial-analysis.ts";
import {
  compareGuidance,
  percentChange,
  ratio,
  type Metric,
  type Guidance,
} from "./domain.ts";
import {
  comparisonPeriods,
  sortPeriods,
  selectMetric,
  compatibleMetrics,
} from "./periods.ts";
export type CalculatedFinding = {
  evidence_type?: "reported" | "calculated";
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
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(v);
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
    compatibleMetrics(a, b) &&
    (!samePeriod || a.period === b.period);
  if (/guidance|promise|deliver/.test(q)) {
    const relevant = guidance.filter(
      (g) =>
        g.ticker === ticker &&
        (!g.superseded || /original|revis|supersed|historical/.test(q)) &&
        (!requestedPeriod || g.period === requestedPeriod) &&
        (!/margin/.test(q) || g.metric === "Operating margin") &&
        (!/revenue/.test(q) || g.metric === "Revenue growth"),
    );
    for (const g of relevant) {
      const result = compareGuidance(g);
      if (result.variance !== null)
        findings.push({
          text: `${g.period} ${g.metric.toLowerCase()} (${g.superseded ? "original, superseded" : g.revised ? "revised" : "target"}): ${result.explanation} ${g.qualifier}`,
          sources: [
            { document_id: g.guidance_document, page: g.guidance_page },
            { document_id: g.actual_document, page: g.actual_page },
          ],
        });
    }
  }
  if (
    /figures|snapshot|report.*(?:ebitda|profit)|consolidated.*(?:revenue|profit)/i.test(
      q,
    )
  ) {
    const latest = requestedPeriod ?? sortPeriods(rows.map((m) => m.period))[0];
    for (const name of [
      "Revenue",
      "Total income",
      "EBITDA",
      "PAT",
      "Debt",
      "Borrowings",
    ]) {
      const m = latest ? selectMetric(rows, name, latest) : undefined;
      if (m && m.value !== null)
        findings.push({
          text: `${m.period} ${m.name}: ${amount(m)} (${m.basis}).`,
          sources: [source(m)],
          evidence_type: "reported",
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
    const ocf = selectMetric(rows, "Operating cash flow", cashPeriod),
      fcf = selectMetric(rows, "Free cash flow", cashPeriod, ocf),
      pat = selectMetric(rows, "PAT", cashPeriod, ocf ?? fcf),
      capex = selectMetric(rows, "Capital expenditure", cashPeriod, ocf);
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
        text: `${fcf.period} reported free cash flow was ${amount(fcf)}. Free cash flow is after capital expenditure; inspect the cash-flow statement for working-capital movements.`,
        sources: [source(fcf)],
      });
    else if (ocf && capex && comparable(ocf, capex, true)) {
      const value = ocf.value! - Math.abs(capex.value!);
      findings.push({
        text: `${ocf.period} calculated free cash flow was ${amount({ ...ocf, value })}: operating cash flow of ${amount(ocf)} less capital expenditure of ${amount({ ...capex, value: Math.abs(capex.value!) })}. Capital expenditure is treated as an outflow magnitude; both inputs use ${ocf.basis} and ${ocf.unit}.`,
        sources: [source(ocf), source(capex)],
      });
    }
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
    const current = selectMetric(rows, "Revenue", currentPeriod);
    const comparisons = annual
      ? [[periods[1], "year on year"]]
      : [
          [periods[1], "quarter on quarter"],
          [periods[2], "year on year"],
        ];
    for (const [period, label] of comparisons) {
      const base = current
        ? selectMetric(rows, "Revenue", period, current)
        : undefined;
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
  if (
    /margin|ratio|fcf|free cash|roe|roce|working capital|inventory days|receivable|payable|ttm|cagr|leverage|debt.to.equity|cash conversion/i.test(
      q,
    )
  ) {
    const target =
      requestedPeriod ??
      (/annual|cagr|roe|roce/i.test(q)
        ? sortPeriods(
            rows.filter((m) => /^FY/.test(m.period)).map((m) => m.period),
          )[0]
        : comparisonPeriods(rows)[0]);
    if (target)
      for (const c of financialAnalysis(
        rows,
        target,
        /BANK\.NS$/.test(ticker) ? "financial" : "nonfinancial",
      ).filter((c) => c.status === "verified")) {
        const relevant = /margin/.test(q)
          ? /margin/i.test(c.name)
          : /ttm/.test(q)
            ? /TTM/.test(c.name)
            : /cagr/.test(q)
              ? /CAGR/.test(c.name)
              : /roe|roce/.test(q)
                ? /ROE|ROCE/.test(c.name)
                : /debt|leverage/.test(q)
                  ? /equity|ratio/i.test(c.name)
                  : /working capital|inventory|receivable|payable/.test(q)
                    ? /days|cycle/.test(c.name)
                    : /cash/.test(q)
                      ? /cash/i.test(c.name)
                      : true;
        if (relevant && !findings.some((f) => f.text.includes(c.name)))
          findings.push({
            text: `${c.period} ${c.name}: ${money(c.value!)} ${c.unit}. Definition: ${c.formula}. Inputs: ${c.inputs.map((m) => `${m.name} ${m.value} ${m.unit} (${m.period})`).join("; ")}.`,
            sources: [
              ...new Map(
                c.inputs.map((m) => [`${m.document_id}:${m.page}`, source(m)]),
              ).values(),
            ],
            evidence_type: "calculated",
          });
      }
  }
  return findings;
}
