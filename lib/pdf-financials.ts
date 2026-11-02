import type { ExtractedMetric } from "./financial-extraction.ts";
export type PdfItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height?: number;
};
export type PdfLayout = { page: number; text: string; items: PdfItem[] };
export const PDF_LAYOUT_VERSION = "pdf_layout_v3";
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const fy = (y: string) => (+y < 100 ? 2000 + +y : +y);
export function financialHeaderDate(raw: string) {
  raw = raw.replace(/(\d)(?:st|nd|rd|th|[•·]1?)/gi, "$1 ");
  const numeric = raw.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
  if (numeric) {
    const month = +numeric[2],
      year = fy(numeric[3]);
    return month >= 1 &&
      month <= 12 &&
      +numeric[1] === new Date(Date.UTC(year, month, 0)).getUTCDate()
      ? { month, year }
      : null;
  }
  const m = raw.match(
    /(?:^|[^a-z])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i,
  );
  const y = raw.match(/\b(20\d{2})\b/) ?? raw.match(/['’\-](\d{2})(?:\D|$)/);
  return m && y
    ? { month: months.indexOf(m[1].toLowerCase()) + 1, year: fy(y[1]) }
    : null;
}
export function fiscalLabel(
  month: number,
  year: number,
  endMonth: number,
  kind: "quarter" | "half" | "year",
) {
  const elapsed = (month - endMonth + 12) % 12 || 12,
    endingYear = year + (month > endMonth ? 1 : 0);
  if (kind === "year") return month === endMonth ? `FY${year}` : null;
  if (kind === "half")
    return elapsed % 6 === 0 ? `H${elapsed / 6} FY${endingYear}` : null;
  return elapsed % 3 === 0 ? `Q${elapsed / 3} FY${endingYear}` : null;
}
function rows(items: PdfItem[]) {
  const out: { y: number; items: PdfItem[]; text: string }[] = [];
  for (const i of [...items]
    .filter((i) => i.text.trim() && !/^(?:st|nd|rd|th)$/i.test(i.text.trim()))
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    let r = out.find((r) => Math.abs(r.y - i.y) < 3.5);
    if (!r) {
      r = { y: i.y, items: [], text: "" };
      out.push(r);
    }
    r.items.push(i);
  }
  for (const r of out) {
    r.items.sort((a, b) => a.x - b.x);
    r.text = r.items.map((i) => i.text).join(" ");
  }
  return out.sort((a, b) => b.y - a.y);
}
function metricName(label: string) {
  const s = label
    .replace(/^\s*(?:[IVX]+|\d+)[.)]?\s+/i, "")
    .replace(/[¹²³*]/g, "")
    .replace(/\s+\d+\.\d+$/, "")
    .trim();
  if (
    /^(?:revenue from operations|operating revenue|revenue|sales)(?:\s*\([\d+ -]+\))?$/i.test(
      s,
    )
  )
    return { name: "Revenue", score: 1 };
  if (/^EBITDA(?:\d)?$/i.test(s)) return { name: "EBITDA", score: 1 };
  if (/^profit before tax(?:\s*\([\d+ -]+\))?$/i.test(s) || /^PBT$/i.test(s))
    return { name: "PBT", score: 1 };
  if (/^profit after tax(?: and share of profit.*)?(?:\d)?$/i.test(s))
    return { name: "PAT", score: /share of/i.test(s) ? 3 : 2 };
  if (
    /^(?:net )?profit (?:for|after tax for) the (?:period|quarter|year)(?:\s*\([\d+ -]+\))?$/i.test(
      s,
    ) ||
    /^PAT$/i.test(s)
  )
    return { name: "PAT", score: 3 };
  return null;
}
export function extractPdfFinancials(
  layouts: PdfLayout[],
  company: { ticker: string; name: string },
  verified?: { yearEndMonth?: number; currency?: string; source?: string },
) {
  const metrics: ExtractedMetric[] = [];
  const reviews: { page: number; reason: string }[] = [];
  const periods = new Set<string>();
  let calendar: { month: number; page: number; evidence: string } | null = null;
  // Infer a calendar only from an explicit annual statement header in this same original document.
  for (const p of layouts) {
    const target = compact(company.name.replace(/limited|ltd\.?/gi, ""));
    if (!compact(p.text).includes(target)) continue;
    for (const h of p.items.filter((i) =>
      /^Year\s*ended$/i.test(i.text.trim()),
    )) {
      const year = p.items
        .filter(
          (i) => /^20\d{2}$/.test(i.text.trim()) && i.y < h.y && i.y > h.y - 45,
        )
        .sort(
          (a, b) =>
            Math.abs(a.x + a.width / 2 - (h.x + h.width / 2)) -
            Math.abs(b.x + b.width / 2 - (h.x + h.width / 2)),
        )[0];
      if (!year || Math.abs(year.x + year.width / 2 - h.x - h.width / 2) > 40)
        continue;
      const raw = p.items
        .filter(
          (i) =>
            i.y <= h.y &&
            i.y >= year.y - 2 &&
            i.width < 100 &&
            Math.abs(i.x + i.width / 2 - h.x - h.width / 2) < 40,
        )
        .sort((a, b) => b.y - a.y)
        .map((i) => i.text)
        .join(" ");
      const d = financialHeaderDate(raw);
      if (d) calendar = { month: d.month, page: p.page, evidence: raw };
    }
  }
  for (const page of [...layouts].sort((a, b) => a.page - b.page)) {
    const lines = rows(page.items),
      target = compact(company.name.replace(/limited|ltd\.?/gi, "")),
      symbol = compact(company.ticker.replace(/\.NS$/, ""));
    const quarterHeaders = lines.filter(
      (r) =>
        r.items.filter((i) => /Q[1-4]\s*FY\s*['’]?\d{2,4}/i.test(i.text))
          .length >= 2,
    );
    const dateHeaders = lines.filter(
      (r) => r.items.filter((i) => financialHeaderDate(i.text)).length >= 2,
    );
    const vertical = lines
      .map((row) => {
        const years = row.items.filter((i) => /^20\d{2}$/.test(i.text.trim()));
        if (years.length < 2) return null;
        const heads = page.items.filter(
          (i) =>
            i.y > row.y &&
            i.y < row.y + 65 &&
            i.width < 150 &&
            /quarter|three\s*months|half[-\s]*year|six\s*months|year\s*ended/i.test(
              i.text,
            ),
        );
        const columns = years
          .map((i) => {
            const x = i.x + i.width / 2;
            const head = [...heads].sort(
              (a, b) =>
                Math.abs(a.x + a.width / 2 - x) -
                Math.abs(b.x + b.width / 2 - x),
            )[0];
            const text = [...page.items]
              .filter(
                (p) =>
                  p.y >= row.y - 2 &&
                  p.y <= row.y + 65 &&
                  p.width < 150 &&
                  p.x <= x + 12 &&
                  p.x + p.width >= x - 25,
              )
              .sort((a, b) => b.y - a.y || a.x - b.x)
              .map((p) => p.text)
              .join(" ");
            const raw = (head?.text ?? "") + " " + text;
            const date = financialHeaderDate(raw);
            const kind = /half[-\s]*year|six\s*months|6\s*months/i.test(
              head?.text ?? "",
            )
              ? ("half" as const)
              : /quarter|three\s*months|3\s*months/i.test(head?.text ?? "")
                ? ("quarter" as const)
                : /year\s*ended/i.test(head?.text ?? "")
                  ? ("year" as const)
                  : null;
            return date && kind ? { x, ...date, kind, raw } : null;
          })
          .filter((c) => c !== null);
        return columns.length === years.length ? { row, columns } : null;
      })
      .find((v) => v !== null);
    const header =
      quarterHeaders[0] ??
      ((vertical?.row.y ?? -Infinity) > (dateHeaders[0]?.y ?? -Infinity)
        ? vertical?.row
        : dateHeaders[0]);
    if (!header) continue;
    const top = page.items
      .filter((i) => i.y >= header.y - 2)
      .map((i) => i.text)
      .join(" ");
    if (
      !(target.length >= 5 && compact(top).includes(target)) &&
      !(symbol.length >= 4 && compact(top).includes(symbol))
    )
      continue;
    const consolidated = /\bconsolidated\b/i.test(top),
      standalone = /\bstandalone\b/i.test(top);
    if (consolidated === standalone) {
      reviews.push({
        page: page.page,
        reason: "Table accounting scope is ambiguous.",
      });
      continue;
    }
    const basis = `${consolidated ? "Consolidated" : "Standalone"} reported INR`;
    const currency = /(?:₹|INR|Rs\.?|Rupees).{0,12}crores?/i.test(page.text)
      ? "INR"
      : verified?.currency;
    let columns: { x: number; period: string | null; raw: string }[] = [];
    if (quarterHeaders.length) {
      columns = header.items.flatMap<{
        x: number;
        period: string | null;
        raw: string;
      }>((i) => {
        const q = i.text.match(/Q([1-4])\s*FY\s*['’]?(\d{2,4})/i);
        return q
          ? [
              {
                x: i.x + i.width / 2,
                period: `Q${q[1]} FY${fy(q[2])}`,
                raw: i.text,
              },
            ]
          : /YoY|Change/i.test(i.text)
            ? [{ x: i.x + i.width / 2, period: null, raw: i.text }]
            : [];
      });
      for (const i of page.items.filter(
        (i) => Math.abs(i.y - header.y) < 24 && /YoY|Change/i.test(i.text),
      )) {
        const x = i.x + i.width / 2;
        if (!columns.some((c) => Math.abs(c.x - x) < 20))
          columns.push({ x, period: null, raw: i.text });
      }
    } else if (vertical && header === vertical.row) {
      const annual = vertical.columns.filter((c) => c.kind === "year");
      const months = new Set(annual.map((c) => c.month));
      const month =
        months.size === 1
          ? annual[0].month
          : annual.length
            ? null
            : (calendar?.month ?? verified?.yearEndMonth);
      if (!month) {
        reviews.push({
          page: page.page,
          reason: "Fiscal calendar is not verified for multiline date headers.",
        });
        continue;
      }
      if (annual.length)
        calendar = { month, page: page.page, evidence: annual[0].raw };
      columns = vertical.columns.map((c) => ({
        x: c.x,
        period: fiscalLabel(c.month, c.year, month, c.kind),
        raw: c.raw,
      }));
    } else {
      const groups = page.items
        .filter(
          (i) =>
            i.y > header.y &&
            i.y < header.y + 38 &&
            /^(?:Quarter|Three\s*months|3\s*months|Half\s*year|Six\s*months|6\s*months|Year)\s*ended/i.test(
              i.text,
            ),
        )
        .map((i) => ({
          x: i.x + i.width / 2,
          kind: /^(?:half|six|6)/i.test(i.text)
            ? ("half" as const)
            : /^(?:quarter|three|3)/i.test(i.text)
              ? ("quarter" as const)
              : ("year" as const),
          raw: i.text,
        }));
      const dates = page.items
        .filter((i) => Math.abs(i.y - header.y) < 21 && i.width < 140)
        .flatMap((i) => {
          const d = financialHeaderDate(i.text);
          return d ? [{ x: i.x + i.width / 2, y: i.y, ...d, raw: i.text }] : [];
        });
      const classified = dates
        .map((d) => ({
          ...d,
          group: (() => {
            const context = page.items
              .filter(
                (i) =>
                  i.y > d.y &&
                  i.y < d.y + 56 &&
                  i.width < 140 &&
                  i.x <= d.x + 18 &&
                  i.x + i.width >= d.x - 18,
              )
              .sort((a, b) => b.y - a.y || a.x - b.x)
              .map((i) => i.text)
              .join(" ");
            const kind = /half[-\s]*year|six\s*months|6\s*months/i.test(context)
              ? ("half" as const)
              : /quarter|three\s*months|3\s*months/i.test(context)
                ? ("quarter" as const)
                : /year\s*ended/i.test(context)
                  ? ("year" as const)
                  : null;
            return !groups.some((g) => g.kind === "year") && kind
              ? { x: d.x, kind, raw: context }
              : [...groups].sort(
                  (a, b) => Math.abs(a.x - d.x) - Math.abs(b.x - d.x),
                )[0];
          })(),
        }))
        .filter((d) => !!d.group);
      const annual = classified.filter((d) => d.group!.kind === "year");
      const annualMonths = new Set(annual.map((a) => a.month));
      const month =
        annualMonths.size === 1
          ? annual[0].month
          : annual.length
            ? null
            : (calendar?.month ?? verified?.yearEndMonth);
      if (!month) {
        reviews.push({
          page: page.page,
          reason:
            "Fiscal calendar is not verified; dated columns were not assigned to fiscal quarters.",
        });
        continue;
      }
      if (annual.length)
        calendar = {
          month,
          page: page.page,
          evidence: `${annual[0].group!.raw}: ${annual[0].raw}`,
        };
      columns = classified.map((d) => ({
        x: d.x,
        period: fiscalLabel(d.month, d.year, month, d.group!.kind),
        raw: d.group!.raw + " " + d.raw,
      }));
    }
    for (const c of columns) if (c.period) periods.add(c.period);
    if (
      currency !== "INR" ||
      !/crores?/i.test(page.text) ||
      /\b(?:USD|US\$)\b.{0,12}crore/i.test(page.text)
    ) {
      reviews.push({
        page: page.page,
        reason:
          "Currency/scale not established by the source or verified company statement.",
      });
      continue;
    }
    columns.sort((a, b) => a.x - b.x);
    if (columns.filter((c) => c.period).length < 2) continue;
    const first = columns[0].x;
    const found: { m: ExtractedMetric; score: number }[] = [];
    for (const line of lines.filter((r) => r.y < header.y - 4)) {
      const label = line.items
        .filter((i) => i.x + i.width < first - 18)
        .map((i) => i.text)
        .join(" ");
      const named = metricName(label);
      if (!named) continue;
      const dataLine =
        lines
          .filter(
            (r) =>
              Math.abs(r.y - line.y) <= 6 &&
              r.items.filter((i) => i.x >= first - 25 && /\d/.test(i.text))
                .length >= 2,
          )
          .sort((a, b) => Math.abs(a.y - line.y) - Math.abs(b.y - line.y))[0] ??
        line;
      const cells = new Map<number, string[]>();
      for (const item of dataLine.items.filter((i) => i.x >= first - 25)) {
        const k = columns.reduce(
          (best, c, j) =>
            Math.abs(c.x - (item.x + item.width / 2)) <
            Math.abs(columns[best].x - (item.x + item.width / 2))
              ? j
              : best,
          0,
        );
        const list = cells.get(k) ?? [];
        list.push(item.text);
        cells.set(k, list);
      }
      for (let k = 0; k < columns.length; k++) {
        const col = columns[k];
        if (!col.period) continue;
        const parts = cells.get(k) ?? [];
        if (
          parts.filter((s) => /^\(?-?[\d,]+(?:\.\d+)?\)?$/.test(s.trim()))
            .length > 1
        ) {
          reviews.push({
            page: page.page,
            reason: `Multiple numeric cells align to ${col.raw}; values were not concatenated.`,
          });
          continue;
        }
        const raw = parts.join("").replace(/\s/g, "");
        if (!/^\(?-?[\d,]+(?:\.\d+)?\)?$/.test(raw)) continue;
        const value =
          Number(raw.replace(/[(),]/g, "")) * (raw.startsWith("(") ? -1 : 1);
        if (!Number.isFinite(value)) continue;
        found.push({
          score: named.score,
          m: {
            name: named.name,
            value,
            period: col.period,
            unit: "INR crore",
            basis,
            page: page.page,
            evidence_text: page.text,
            verification_status: "source_checked",
            extraction_method: PDF_LAYOUT_VERSION,
            reporting_status: "reported",
          },
        });
      }
    }
    for (const f of found) {
      if (
        found.some(
          (o) =>
            o.m.name === f.m.name &&
            o.m.period === f.m.period &&
            o.score > f.score,
        )
      )
        continue;
      const peers = found.filter(
        (o) =>
          o.m.name === f.m.name &&
          o.m.period === f.m.period &&
          o.score === f.score,
      );
      if (new Set(peers.map((o) => o.m.value)).size !== 1) {
        reviews.push({
          page: page.page,
          reason: `Conflicting ${f.m.name} rows for ${f.m.period}; review required.`,
        });
        continue;
      }
      if (
        !metrics.some(
          (m) =>
            m.name === f.m.name &&
            m.period === f.m.period &&
            m.basis === f.m.basis,
        )
      )
        metrics.push(f.m);
    }
  }
  return { metrics, reviews, calendar, periods: [...periods] };
}
export async function captureFinancialLayouts(
  pdf: {
    getPage: (
      n: number,
    ) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }>;
  },
  pages: string[],
) {
  const indices = pages
    .map((text, i) => ({
      text,
      i,
      score:
        (i < 30 &&
        /Revenue from operations/i.test(text) &&
        /Profit before tax/i.test(text)
          ? 2500
          : 0) +
        (/statement[\s\S]{0,90}profit|statement[\s\S]{0,45}financial results/i.test(
          text,
        ) ||
        (/revenue from operations/i.test(text) &&
          /profit before tax/i.test(text) &&
          /profit (?:for the period|after tax)/i.test(text))
          ? 2000
          : 0) +
        (/financial results|statement.*profit|financial performance/i.test(text)
          ? 100
          : 0) +
        Math.min(
          8,
          (
            text.match(/revenue|EBITDA|profit before tax|profit after tax/gi) ??
            []
          ).length,
        ),
    }))
    .filter((p) => p.score > 1)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 12);
  const result: PdfLayout[] = [];
  for (const p of indices) {
    const page = await pdf.getPage(p.i + 1),
      content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const value of content.items) {
      const i = value as {
        str?: string;
        transform?: number[];
        width?: number;
        height?: number;
      };
      if (
        typeof i.str === "string" &&
        i.transform &&
        typeof i.width === "number"
      )
        items.push({
          text: i.str,
          x: i.transform[4],
          y: i.transform[5],
          width: i.width,
          height: i.height,
        });
    }
    result.push({ page: p.i + 1, text: p.text, items: items.slice(0, 5000) });
  }
  return result;
}
