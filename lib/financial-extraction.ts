import type { Metric } from "./domain.ts";
export type ExtractedMetric = Omit<
  Metric,
  "id" | "ticker" | "document_id" | "page"
> & { page: number; evidence_text: string };
export type ExtractedGuidance = {
  metric: string;
  period: string;
  low: number;
  high: number;
  unit: string;
  basis: string;
  page: number;
  quote: string;
};
export function inferHeaderPeriod(pages: { page: number; text: string }[]) {
  const m = pages
    .filter((p) => p.page <= 4)
    .map((p) => p.text)
    .join(" ")
    .match(/Q([1-4])\s*FY\s*['’]?\s*(\d{2,4})/i);
  return m
    ? `Q${m[1]} FY${Number(m[2]) < 100 ? 2000 + Number(m[2]) : m[2]}`
    : null;
}
const fiscal = (raw: string) => {
  const n = Number(raw);
  return n < 100 ? 2000 + n : n;
};
const period = (s: string) => {
  const q = s.match(/Q([1-4])\s*FY\s*['’]?\s*(\d{2,4})/i);
  if (q) return `Q${q[1]} FY${fiscal(q[2])}`;
  const y = s.match(/FY\s*['’]?\s*(\d{2,4})/i);
  if (y) return `FY${fiscal(y[1])}`;
  const date = s.match(
    /(quarter|year) ended\s+(March|June|September|December)\s+\d{1,2},?\s*(\d{4})/i,
  );
  if (!date) return null;
  const month = ["march", "june", "september", "december"].indexOf(
      date[2].toLowerCase(),
    ),
    year = Number(date[3]) + (month === 0 ? 0 : 1);
  return date[1].toLowerCase() === "quarter"
    ? `Q${[4, 1, 2, 3][month]} FY${year}`
    : `FY${year}`;
};
const number = (s: string) => Number(s.replaceAll(",", ""));
/** Conservative grammar for explicit INR crore prose. No inferred EBITDA, table-column guesses or fabricated periods. */
export function extractReportedProse(pages: { page: number; text: string }[]) {
  const metrics: ExtractedMetric[] = [],
    guidance: ExtractedGuidance[] = [];
  let basis: string | null = null,
    contextPeriod: string | null = null;
  for (const page of pages) {
    const text = page.text.replace(/\r/g, "");
    const sections = text.split(
      /(?:^|\n)[ \t]*(Standalone results|Consolidated results|For the (?:Quarter|Year|Nine Months|Six Months) ended[^\n]*)[ \t]*(?=\n|$)/i,
    );
    for (let i = 0; i < sections.length; i++) {
      if (/^(Standalone|Consolidated) results\s*$/i.test(sections[i])) {
        basis = /^Standalone/i.test(sections[i])
          ? "Standalone reported INR"
          : "Consolidated reported INR";
        continue;
      }
      if (/^For the (Quarter|Year) ended/i.test(sections[i])) {
        contextPeriod = period(sections[i]);
        continue;
      }
      if (/^For the (Nine|Six) Months ended/i.test(sections[i])) {
        contextPeriod = null;
        continue;
      }
      const lines = sections[i].replace(/\s+/g, " ").replace(/Rs\./g, "Rs");
      // Explicit Q/FY label adjacent to a quarter or annual heading sets context.
      const heading = lines.match(
        /For the (Quarter|Year) ended.{0,65}\(([^)]+)\)/i,
      );
      if (heading) contextPeriod = period(heading[2]);
      const reports = lines.matchAll(
        /(Total Revenue|Revenue from operations|Earnings before Interest, Tax, Depreciation and Amortization \(EBITDA\)|EBITDA|Net Profit|PAT|PBT|Profit before tax)(?:\s+(?:for|in)\s+([^.;]{1,90}?))?\s+(?:stood at|of|was|at)\s*(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)\s*crore\b([^.;]*(?:[.;]|$))/gi,
      );
      for (const m of reports) {
        if (/nine.months|six.months|half.year|(?:9M|6M)\s*FY/i.test(m[0]))
          continue;
        const currentPeriod = period(m[0]) ?? contextPeriod;
        if (!basis || !currentPeriod) continue;
        const name = /revenue/i.test(m[1])
          ? "Revenue"
          : /EBITDA/i.test(m[1])
            ? "EBITDA"
            : /before tax|PBT/i.test(m[1])
              ? "PBT"
              : "PAT";
        const quote = page.text;
        metrics.push({
          name,
          value: number(m[3]),
          period: currentPeriod,
          unit: "INR crore",
          basis,
          page: page.page,
          evidence_text: quote,
          verification_status: "source_checked",
          extraction_method: "explicit_prose_v1",
        });
        const prior = m[4].match(
          /as compared to\s*(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?)\s*crore/i,
        );
        if (
          prior &&
          /same period last year|corresponding quarter|FY\s*\d/i.test(m[4])
        ) {
          const p = currentPeriod.replace(
            /FY(\d{4})/,
            (_, y) => `FY${Number(y) - 1}`,
          );
          metrics.push({
            name,
            value: number(prior[1]),
            period: p,
            unit: "INR crore",
            basis,
            page: page.page,
            evidence_text: quote,
            verification_status: "source_checked",
            extraction_method: "explicit_prose_v1",
          });
        }
      }
    }
    // Explicit, period-labelled CC revenue guidance. Require consolidated scope in the actual document.
    const whole = pages.map((p) => p.text).join(" ");
    if (/consolidated/i.test(whole)) {
      const flat = text.replace(/\s+/g, " "),
        header = flat.match(/FY\s*['’]?\s*(\d{2,4})\s+Guidance/i);
      if (header) {
        const segment = flat.slice(header.index!, header.index! + 650),
          g = segment.match(
            /(?:Company\s+)?(?:CC\s+)?Revenue growth(?: expected to be)?(?: between| of)?\s*(\d+(?:\.\d+)?)%?\s*[-–]\s*(\d+(?:\.\d+)?)%\s*(?:YoY\s*)?(?:in\s*)?(?:CC|constant currency)?/i,
          );
        if (g && /CC|constant currency/i.test(g[0]))
          guidance.push({
            metric: "Revenue growth",
            period: `FY${fiscal(header[1])}`,
            low: Number(g[1]),
            high: Number(g[2]),
            unit: "%",
            basis: "Consolidated constant-currency revenue growth (%)",
            page: page.page,
            quote: segment.slice(0, segment.indexOf(g[0]) + g[0].length),
          });
      }
      const annual = flat.match(/^\s*FY\s*['’]?\s*(\d{2,4})\s+Highlights/i),
        actual = flat.match(
          /Constant Currency\s*\(CC\) Revenue\s+(up|down)\s+(\d+(?:\.\d+)?)%/i,
        );
      if (annual && actual)
        metrics.push({
          name: "Revenue growth",
          value:
            Number(actual[2]) * (actual[1].toLowerCase() === "down" ? -1 : 1),
          period: `FY${fiscal(annual[1])}`,
          unit: "%",
          basis: "Consolidated constant-currency revenue growth (%)",
          page: page.page,
          evidence_text: actual[0],
          verification_status: "source_checked",
          extraction_method: "explicit_prose_v1",
        });
    }
  }
  return {
    metrics: metrics.filter(
      (m, i, a) =>
        a.findIndex(
          (n) =>
            n.name === m.name && n.period === m.period && n.basis === m.basis,
        ) === i,
    ),
    guidance,
  };
}

/** Delimited text tables only. Never guess flattened PDF column alignment. */
export function extractExplicitTables(pages: { page: number; text: string }[]) {
  const metrics: ExtractedMetric[] = [],
    rejected: { page: number; reason: string }[] = [];
  const names: [RegExp, string][] = [
    [/^(revenue(?: from operations)?|sales)$/i, "Revenue"],
    [/^EBITDA$/i, "EBITDA"],
    [/^(PBT|profit before tax)$/i, "PBT"],
    [/^(PAT|net profit|profit after tax)$/i, "PAT"],
    [
      /^(operating cash flow|cash from operations|net cash (?:generated )?from operating activities)$/i,
      "Operating cash flow",
    ],
    [
      /^(capital expenditure|capex|purchase of property,? plant and equipment)$/i,
      "Capital expenditure",
    ],
    [/^free cash flow$/i, "Free cash flow"],
    [/^(total debt|borrowings)$/i, "Debt"],
    [/^(total equity|shareholders.? equity)$/i, "Equity"],
  ];
  for (const page of pages) {
    const text = page.text;
    const basis =
      /\bconsolidated\b/i.test(text) && !/\bstandalone\b/i.test(text)
        ? "Consolidated reported INR"
        : /\bstandalone\b/i.test(text) && !/\bconsolidated\b/i.test(text)
          ? "Standalone reported INR"
          : null;
    const units = [
      ...text.matchAll(/(?:INR|₹|Rs\.?)\s*(crore|million|lakh|billion)s?\b/gi),
    ];
    const scales = [...new Set(units.map((m) => m[1].toLowerCase()))];
    if (!basis || scales.length !== 1) continue;
    const lines = text.split(/\r?\n/),
      split = (line: string) =>
        line
          .split(/\s*\|\s*|\t+| {2,}/)
          .map((x) => x.trim())
          .filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const header = split(lines[i]),
        periods = header.slice(1);
      if (
        !periods.length ||
        !periods.every((p) =>
          /^(?:Q[1-4]\s+)?FY\d{4}(?:\s*\((?:audited|unaudited|restated)\))?$/i.test(
            p,
          ),
        )
      )
        continue;
      for (let j = i + 1; j < Math.min(lines.length, i + 20); j++) {
        const cells = split(lines[j]),
          name = names.find(([re]) => re.test(cells[0] ?? ""))?.[1];
        if (!name) continue;
        if (
          cells.length !== header.length ||
          !cells.slice(1).every((v) => /^\(?-?[\d,]+(?:\.\d+)?\)?$/.test(v))
        ) {
          rejected.push({
            page: page.page,
            reason: `${name}: ambiguous or missing table columns; not used in calculations.`,
          });
          continue;
        }
        for (let k = 0; k < periods.length; k++) {
          const raw = cells[k + 1],
            value =
              Number(raw.replace(/[(),]/g, "")) *
              (raw.startsWith("(") ? -1 : 1);
          metrics.push({
            name,
            value,
            period: periods[k].replace(/\s*\([^)]*\)/, "").toUpperCase(),
            unit: `INR ${scales[0]}`,
            basis,
            page: page.page,
            evidence_text: text,
            verification_status: "source_checked",
            extraction_method: "explicit_table_v1",
            reporting_status: /restated/i.test(periods[k])
              ? "restated"
              : /unaudited/i.test(periods[k])
                ? "unaudited"
                : /audited/i.test(periods[k])
                  ? "audited"
                  : "reported",
          });
        }
      }
    }
  }
  return { metrics, rejected };
}
export function extractionPassages<T extends { text: string; page: number }>(
  chunks: T[],
  type: string,
) {
  const pattern =
    type === "annual_report"
      ? /cash flow|operating activities|capital expenditure|borrowings|equity|consolidated|financial statement/i
      : type === "transcript"
        ? /guidance|outlook|expect|margin|growth|commit|investment/i
        : /consolidated|revenue|profit|ebitda|financial results|quarter|guidance/i;
  return chunks
    .map((c) => ({
      c,
      score: (c.text.match(new RegExp(pattern.source, "gi")) ?? []).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.page - b.c.page)
    .slice(0, 16)
    .map((x) => x.c);
}
