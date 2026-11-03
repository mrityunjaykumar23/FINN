import { percentChange, type Metric } from "./domain.ts";
import {
  selectMetric,
  compatibleMetrics,
  fiscalPeriod,
  sortPeriods,
} from "./periods.ts";
export type FinancialCalculation = {
  name: string;
  value: number | null;
  unit: string;
  period: string;
  basis: string | null;
  formula: string;
  status: "verified" | "insufficient_evidence" | "not_applicable";
  reason: string | null;
  inputs: Metric[];
  verification_status: "deterministic";
};
/** Arithmetic consumes accepted originals only; no imputation, FX assumptions or proxy quarter sums. */
export function financialAnalysis(
  metrics: Metric[],
  period: string,
  sector = "nonfinancial",
) {
  const rows = metrics.filter(
      (m) =>
        m.verification_status !== "unverified" &&
        m.value !== null &&
        Number.isFinite(m.value),
    ),
    out: FinancialCalculation[] = [];
  const balanceNames = new Set([
    "Equity",
    "Assets",
    "Liabilities",
    "Current assets",
    "Current liabilities",
    "Inventory",
    "Receivables",
    "Payables",
    "Cash and cash equivalents",
    "Borrowings",
    "Debt",
    "Current borrowings",
    "Non-current borrowings",
  ]);
  const get = (name: string, p = period, anchor?: Metric) => {
    const exact = selectMetric(rows, name, p, anchor);
    if (exact || !balanceNames.has(name)) return exact;
    const end = p.match(/^(FY|H[12] FY)(\d{4})$/);
    if (!end) return undefined;
    return selectMetric(
      rows,
      name,
      `Q${end[1].startsWith("H1") ? 2 : 4} FY${end[2]}`,
      anchor,
    );
  };
  const add = (
    name: string,
    inputs: (Metric | undefined)[],
    formula: string,
    unit: string,
    compute: (v: number[]) => number | null,
    options: { notApplicable?: boolean; reason?: string; period?: string } = {},
  ) => {
    let value: number | null = null,
      reason: string | null = null;
    if (options.notApplicable)
      reason =
        "This metric is not applied to banks or financial companies using industrial-company definitions.";
    else if (
      inputs.some((m) => !m) ||
      !inputs.length ||
      inputs.some((m) => !compatibleMetrics(inputs[0], m))
    )
      reason =
        options.reason ??
        "Compatible verified inputs are missing or conflict in accounting basis, reporting currency or scale.";
    else {
      value = compute(inputs.map((m) => m!.value!));
      if (value === null || !Number.isFinite(value)) {
        value = null;
        reason =
          options.reason ??
          "The denominator or comparison base is zero, negative or otherwise unsuitable.";
      }
    }
    const result: FinancialCalculation = {
      name,
      value,
      unit,
      formula,
      period: options.period ?? period,
      basis: inputs.find((m) => m)?.basis ?? null,
      status: options.notApplicable
        ? "not_applicable"
        : value === null
          ? "insufficient_evidence"
          : "verified",
      reason,
      inputs: inputs.filter((m): m is Metric => !!m),
      verification_status: "deterministic",
    };
    out.push(result);
    return result;
  };
  const ratio = (v: number[], scale = 1) =>
    v[1] > 0 ? (v[0] / v[1]) * scale : null;
  const revenue = get("Revenue"),
    pat = get("PAT", period, revenue),
    ebitda = get("EBITDA", period, revenue),
    operating =
      get("Operating profit", period, revenue) ?? get("EBIT", period, revenue);
  add("PAT margin", [pat, revenue], "PAT / revenue × 100", "%", (v) =>
    ratio(v, 100),
  );
  add(
    "EBITDA margin",
    [ebitda, revenue],
    "Reported EBITDA / revenue × 100",
    "%",
    (v) => ratio(v, 100),
    { notApplicable: sector === "financial" },
  );
  add(
    "Operating margin",
    [operating, revenue],
    "Reported operating profit or EBIT / revenue × 100",
    "%",
    (v) => ratio(v, 100),
    { notApplicable: sector === "financial" },
  );
  const current = fiscalPeriod(period);
  for (const name of ["Revenue", "EBITDA", "PBT", "PAT"]) {
    const actual = get(name),
      prior = current?.quarter
        ? `Q${current.quarter === 1 ? 4 : current.quarter - 1} FY${current.quarter === 1 ? current.year - 1 : current.year}`
        : undefined;
    if (prior)
      add(
        `${name} QoQ growth`,
        [actual, actual ? get(name, prior, actual) : undefined],
        "(current quarter − prior quarter) / prior quarter × 100",
        "%",
        (v) => percentChange(v[0], v[1]).value,
        { notApplicable: sector === "financial" && name === "EBITDA" },
      );
    const previousYear = current
      ? period.replace(/FY\d{4}$/, `FY${current.year - 1}`)
      : undefined;
    add(
      `${name} ${period.startsWith("FY") ? "annual" : "YoY"} growth`,
      [
        actual,
        actual && previousYear ? get(name, previousYear, actual) : undefined,
      ],
      "(current reported period − same period last year) / prior period × 100",
      "%",
      (v) => percentChange(v[0], v[1]).value,
      { notApplicable: sector === "financial" && name === "EBITDA" },
    );
  }
  const equity = get("Equity"),
    debt = get("Debt", period, equity),
    borrowings = get("Borrowings", period, equity),
    short = get("Current borrowings", period, equity),
    long = get("Non-current borrowings", period, equity);
  add(
    "Debt-to-equity",
    [debt, equity],
    "Reported total debt / equity",
    "x",
    (v) => ratio(v),
    { notApplicable: sector === "financial" },
  );
  add(
    "Borrowings-to-equity",
    borrowings ? [borrowings, equity] : [short, long, equity],
    borrowings
      ? "Reported total borrowings / equity"
      : "(current + non-current borrowings) / equity; excludes unreported lease debt",
    "x",
    (v) => (v.length === 2 ? ratio(v) : v[2] > 0 ? (v[0] + v[1]) / v[2] : null),
    { notApplicable: sector === "financial" },
  );
  const ca = get("Current assets"),
    cl = ca ? get("Current liabilities", period, ca) : undefined,
    inventory = ca ? get("Inventory", period, ca) : undefined;
  add(
    "Current ratio",
    [ca, cl],
    "Current assets / current liabilities",
    "x",
    (v) => ratio(v),
    { notApplicable: sector === "financial" },
  );
  add(
    "Quick ratio",
    [ca, inventory, cl],
    "(current assets − inventory) / current liabilities",
    "x",
    (v) => (v[2] > 0 ? (v[0] - v[1]) / v[2] : null),
    { notApplicable: sector === "financial" },
  );
  const ocf = get("Operating cash flow"),
    flowPat = ocf ? get("PAT", period, ocf) : undefined,
    capex = get("Capital expenditure", period, ocf),
    ppe = get("PPE purchases", period, ocf),
    intangibles = get("Intangible purchases", period, ocf);
  add(
    "Cash conversion",
    [ocf, flowPat],
    "Operating cash flow / PAT × 100 for the same reporting duration",
    "%",
    (v) => ratio(v, 100),
    { notApplicable: sector === "financial" },
  );
  add(
    "Free cash flow",
    capex ? [ocf, capex] : [ocf, ppe, intangibles],
    capex
      ? "Operating cash flow − absolute reported capital expenditure"
      : "Operating cash flow − absolute PPE cash purchases − absolute intangible cash purchases (excludes acquisitions)",
    ocf?.unit ?? "reported currency",
    (v) => v[0] - v.slice(1).reduce((s, n) => s + Math.abs(n), 0),
    { notApplicable: sector === "financial" },
  );
  const annual = /^FY\d{4}$/.test(period),
    old = current ? `FY${current.year - 1}` : "",
    oldEquity = equity ? get("Equity", old, equity) : undefined,
    annualPat = get("PAT", period, equity);
  add(
    "ROE",
    [annualPat, equity, oldEquity],
    "Annual PAT / average opening and closing reported equity × 100",
    "%",
    (v) =>
      annual && v[1] > 0 && v[2] > 0
        ? (v[0] / ((v[1] + v[2]) / 2)) * 100
        : null,
    {
      reason:
        "ROE requires a full-year profit and compatible opening/closing equity; quarterly profits are not silently annualised.",
    },
  );
  const assets = get("Assets"),
    oldAssets = assets ? get("Assets", old, assets) : undefined,
    currentLiabilities = assets
      ? get("Current liabilities", period, assets)
      : undefined,
    oldLiabilities = assets
      ? get("Current liabilities", old, assets)
      : undefined,
    ebit = assets ? get("EBIT", period, assets) : undefined;
  add(
    "ROCE",
    [ebit, assets, currentLiabilities, oldAssets, oldLiabilities],
    "Annual EBIT / average (total assets − current liabilities) × 100",
    "%",
    (v) =>
      annual && v[1] - v[2] > 0 && v[3] - v[4] > 0
        ? (v[0] / ((v[1] - v[2] + (v[3] - v[4])) / 2)) * 100
        : null,
    {
      notApplicable: sector === "financial",
      reason:
        "ROCE requires verified annual EBIT and opening/closing capital-employed inputs.",
    },
  );
  const dated =
      revenue?.period_start && revenue.period_end
        ? Math.round(
            (Date.parse(revenue.period_end) -
              Date.parse(revenue.period_start)) /
              86400000,
          ) + 1
        : null,
    cogs = get("Cost of goods sold", period, revenue),
    oldInventory = inventory ? get("Inventory", old, inventory) : undefined,
    receivables = get("Receivables", period, revenue),
    oldReceivables = receivables
      ? get("Receivables", old, receivables)
      : undefined,
    payables = get("Payables", period, revenue),
    oldPayables = payables ? get("Payables", old, payables) : undefined;
  const days = (v: number[], expense = true) =>
    annual && dated && (expense ? Math.abs(v[2]) > 0 : v[2] > 0)
      ? ((v[0] + v[1]) / 2 / (expense ? Math.abs(v[2]) : v[2])) * dated
      : null;
  const inventoryDays = add(
    "Inventory days",
    [inventory, oldInventory, cogs],
    "Average inventory / annual cost of goods sold × verified reporting days",
    "days",
    (v) => days(v),
    {
      notApplicable: sector === "financial",
      reason:
        "Verified annual dates, opening/closing balances and compatible denominator inputs are required.",
    },
  );
  const receivableDays = add(
    "Receivable days (revenue basis)",
    [receivables, oldReceivables, revenue],
    "Average trade receivables / annual revenue × verified reporting days; credit-sales split unavailable",
    "days",
    (v) => days(v, false),
    {
      notApplicable: sector === "financial",
      reason:
        "Verified annual dates, opening/closing balances and compatible denominator inputs are required.",
    },
  );
  const payableDays = add(
    "Payable days (COGS proxy)",
    [payables, oldPayables, cogs],
    "Average trade payables / annual COGS × verified reporting days; COGS is a disclosed purchases proxy",
    "days",
    (v) => days(v),
    {
      notApplicable: sector === "financial",
      reason:
        "Verified annual dates, opening/closing balances and compatible denominator inputs are required.",
    },
  );
  const cycle =
    inventoryDays.value !== null &&
    receivableDays.value !== null &&
    payableDays.value !== null
      ? inventoryDays.value + receivableDays.value - payableDays.value
      : null;
  add(
    "Cash conversion cycle (revenue/COGS proxy)",
    [...inventoryDays.inputs, ...receivableDays.inputs, ...payableDays.inputs],
    "Inventory days + receivable days − payable days; not a company-reported operating cycle",
    "days",
    () => cycle,
    { notApplicable: sector === "financial" },
  );
  if (current?.quarter) {
    for (const name of ["Revenue", "EBITDA", "PBT", "PAT"]) {
      const anchor = get(name);
      let q = current.quarter,
        y = current.year;
      const quarters: string[] = [];
      for (let i = 0; i < 4; i++) {
        quarters.push(`Q${q} FY${y}`);
        if (--q === 0) {
          q = 4;
          y--;
        }
      }
      add(
        `TTM ${name}`,
        quarters.map((p) => (anchor ? get(name, p, anchor) : undefined)),
        "Sum of four consecutive compatible reported quarters; half-year and annual totals excluded",
        anchor?.unit ?? "reported currency",
        (v) => v.reduce((a, b) => a + b, 0),
        { notApplicable: sector === "financial" && name === "EBITDA" },
      );
    }
  }
  if (annual && current)
    for (const name of ["Revenue", "PAT"]) {
      const end = get(name),
        periods = sortPeriods(
          rows
            .filter((m) => m.name === name && /^FY/.test(m.period))
            .map((m) => m.period),
        ).filter((p) => Number(p.slice(2)) <= current.year - 2),
        start =
          end && periods.length ? get(name, periods.at(-1), end) : undefined,
        years = start ? current.year - Number(start.period.slice(2)) : 0;
      add(
        `${name} CAGR`,
        [end, start],
        `(ending annual value / starting annual value)^(1 / ${years || "verified years"}) − 1, × 100`,
        "%",
        (v) =>
          years >= 2 && v[0] > 0 && v[1] > 0
            ? ((v[0] / v[1]) ** (1 / years) - 1) * 100
            : null,
      );
    }
  return out;
}
