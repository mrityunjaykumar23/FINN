import { parseDocument, DomUtils } from "htmlparser2";
import type { Element, AnyNode } from "domhandler";
import {
  financialMetricName,
  monetaryMetric,
} from "./financial-definitions.ts";
import {
  financialUnit,
  financialNumberToken,
  normalizeFinancialValue,
} from "./financial-units.ts";
import { fiscalLabel } from "./pdf-financials.ts";
export const STRUCTURED_VERSION = "structured_financial_v3";
export type FinancialFact = {
  name: string;
  value: number;
  unit: string;
  currency: string | null;
  scale: string;
  original_value: number;
  original_unit: string;
  original_currency: string | null;
  original_scale: string;
  period: string;
  period_start: string | null;
  period_end: string;
  period_kind: "duration" | "instant";
  basis: string;
  page: number;
  evidence_text: string;
  evidence_location: string;
  extraction_method: string;
  verification_status: string;
  extraction_context: string;
};
type Context = {
  start: string | null;
  end: string;
  scope: string;
  kind: "duration" | "instant";
};
const text = (n: AnyNode) =>
  DomUtils.textContent(n).replace(/\s+/g, " ").trim();
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const local = (s: string) => s.split(":").at(-1)!.toLowerCase();
const date = (s: string) => {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/),
    dmy = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  const v = iso ? s : dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
  return v &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
    ? v
    : null;
};
function period(c: Context, endMonth: number) {
  const end = new Date(c.end),
    month = end.getUTCMonth() + 1,
    year = end.getUTCFullYear();
  if (c.kind === "instant")
    return fiscalLabel(month, year, endMonth, "quarter");
  if (!c.start) return null;
  const start = new Date(c.start),
    months = (year - start.getUTCFullYear()) * 12 + month - start.getUTCMonth();
  if (
    start.getUTCDate() !== 1 ||
    end.getUTCDate() !== new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    return null;
  return months === 3
    ? fiscalLabel(month, year, endMonth, "quarter")
    : months === 6
      ? fiscalLabel(month, year, endMonth, "half")
      : months === 12
        ? fiscalLabel(month, year, endMonth, "year")
        : null;
}
function assertCompany(
  metadata: Map<string, string>,
  company: { ticker: string; name: string },
) {
  const symbol = metadata.get("nsesymbol") ?? metadata.get("symbol");
  const name = metadata.get("nameofcompany") ?? metadata.get("companyname");
  const expected = key(company.name.replace(/limited|ltd\.?/gi, ""));
  if (symbol && key(symbol) !== key(company.ticker.replace(/\.NS$/, "")))
    throw Error(
      "source_verification_failed: The structured filing identifies a different NSE symbol.",
    );
  if (!name || expected.length < 5 || !key(name).includes(expected))
    throw Error(
      "source_verification_failed: The structured filing does not verify the requested company name.",
    );
}
function fact(
  name: string,
  raw: string,
  unitCaption: string,
  c: Context,
  yearEnd: number,
  section: number,
  location: string,
  evidence: string,
  extra: unknown,
): FinancialFact | null {
  const value = financialNumberToken(raw),
    u = financialUnit(unitCaption, /EPS/.test(name)),
    p = period(c, yearEnd);
  if (
    value === null ||
    !u ||
    !p ||
    !/(?:Consolidated|Standalone)/i.test(c.scope)
  )
    return null;
  if (/consolidated/i.test(c.scope) === /standalone/i.test(c.scope))
    return null;
  const normalized = normalizeFinancialValue(value, u);
  if (normalized === null) return null;
  return {
    name,
    value: normalized,
    unit: u.normalized_unit,
    currency: u.currency,
    scale: u.normalized_unit.split(" ")[1] ?? u.scale,
    original_value: value,
    original_unit: u.unit,
    original_currency: u.currency,
    original_scale: u.scale,
    period: p,
    period_start: c.start,
    period_end: c.end,
    period_kind: c.kind,
    basis: `${/consolidated/i.test(c.scope) ? "Consolidated" : "Standalone"} reported ${u.currency ?? "ratio"}`,
    page: section,
    evidence_text: evidence,
    evidence_location: location,
    extraction_method: STRUCTURED_VERSION,
    verification_status: "structured_verified",
    extraction_context: JSON.stringify({ context: c, unit: u, source: extra }),
  };
}
type Cell = { value: string; locator: string; column: number };
function tableRows(table: Element, index: number) {
  const trs = DomUtils.findAll((n) => n.name === "tr", table.children).filter(
    (n) => {
      let p = n.parent;
      while (p && !("name" in p && p.name === "table")) p = p.parent;
      return p === table;
    },
  );
  const grid: Cell[][] = [];
  for (let r = 0; r < trs.length; r++) {
    const cells = trs[r].children.filter(
      (n): n is Element => "name" in n && ["td", "th"].includes(n.name),
    );
    grid[r] ??= [];
    let col = 0;
    for (let n = 0; n < cells.length; n++) {
      while (grid[r][col]) col++;
      const cell = cells[n],
        span = Math.min(12, Math.max(1, Number(cell.attribs.colspan) || 1)),
        height = Math.min(20, Math.max(1, Number(cell.attribs.rowspan) || 1));
      for (let dy = 0; dy < height; dy++)
        for (let dx = 0; dx < span; dx++) {
          grid[r + dy] ??= [];
          grid[r + dy][col + dx] = {
            value: text(cell),
            locator: `table ${index}, row ${r + 1}, cell ${n + 1}`,
            column: col + dx,
          };
        }
      col += span;
    }
  }
  return grid;
}
function htmlFacts(raw: string, company: { ticker: string; name: string }) {
  const dom = parseDocument(raw, {
    decodeEntities: true,
    withStartIndices: true,
    withEndIndices: true,
  });
  const tables = DomUtils.findAll((n) => n.name === "table", dom.children);
  const rows = tables.map((t, i) => tableRows(t, i + 1));
  const meta = new Map<string, string>();
  for (const row of rows[0] ?? [])
    if (row.length === 2)
      meta.set(key(row[0]?.value ?? ""), row[1]?.value ?? "");
  assertCompany(meta, company);
  const fyEnd = date(meta.get("dateofendoffinancialyear") ?? ""),
    fyStart = date(meta.get("dateofstartoffinancialyear") ?? "");
  if (!fyEnd || !fyStart)
    throw Error(
      "reporting_period_unresolved: The financial-year boundaries are not verified.",
    );
  const fiscalStart = new Date(fyStart),
    fiscalEnd = new Date(fyEnd);
  if (
    fiscalStart.getUTCDate() !== 1 ||
    fiscalEnd.getUTCDate() !==
      new Date(
        Date.UTC(fiscalEnd.getUTCFullYear(), fiscalEnd.getUTCMonth() + 1, 0),
      ).getUTCDate() ||
    (fiscalEnd.getUTCFullYear() - fiscalStart.getUTCFullYear()) * 12 +
      fiscalEnd.getUTCMonth() -
      fiscalStart.getUTCMonth() +
      1 !==
      12
  )
    throw Error(
      "reporting_period_unresolved: Financial-year boundaries are inconsistent.",
    );
  const yearEnd = new Date(fyEnd).getUTCMonth() + 1;
  const rounding = meta.get("levelofroundingusedinfinancialresults") ?? "";
  if (
    !/^(?:lakhs?|lacs?|crores?|crs?|millions?|billions?|thousands?|units?|actuals?|ones|rupees)$/i.test(
      rounding.trim(),
    )
  )
    throw Error("unit_ambiguous: Rounding scale is not recognized.");
  const caption = `${meta.get("descriptionofpresentationcurrency") ?? ""} ${rounding}`;
  if (!financialUnit(caption))
    throw Error(
      "unit_ambiguous: Presentation currency and rounding scale are not established.",
    );
  const sections = rows.map((r, i) => ({
    page: i + 1,
    text:
      `${company.name}\n${caption}\n` +
      r.map((row) => row.map((c) => c?.value ?? "").join(" | ")).join("\n"),
  }));
  const facts: FinancialFact[] = [],
    reviews: { section: number; name?: string; reason: string }[] = [];
  for (let t = 1; t < rows.length; t++) {
    const table = rows[t];
    const find = (label: RegExp) =>
      table.find((r) => r.some((c) => label.test(c?.value ?? "")));
    const starts = find(/^Date of start of reporting period$/i),
      ends = find(/^Date of end of reporting period$/i),
      scopes = find(/^Nature of report standalone or consolidated$/i);
    if (!ends || !scopes) continue;
    const contexts = new Map<number, Context>();
    const isBalance = table.some((r) =>
      r.some((c) => /^Total assets$/i.test(c?.value ?? "")),
    );
    const isCash = table.some((r) =>
      r.some((c) =>
        /^(?:Statement of cash flows|Cash flows from used in operating activities)$/i.test(
          c?.value ?? "",
        ),
      ),
    );
    for (let j = 0; j < ends.length; j++) {
      const end = date(ends[j]?.value ?? ""),
        start = date(starts?.[j]?.value ?? "");
      if (end && scopes[j])
        contexts.set(j, {
          start: isBalance ? null : start,
          end,
          scope: scopes[j].value,
          kind: isBalance ? "instant" : "duration",
        });
    }
    for (const row of table) {
      const label = row.find((c) => financialMetricName(c?.value ?? ""));
      if (!label) continue;
      const name = financialMetricName(label.value)!;
      if (
        isCash &&
        !/cash flow|Capital expenditure|PPE purchases|Intangible purchases/.test(
          name,
        )
      )
        continue;
      if (
        !isCash &&
        /cash flow|Capital expenditure|PPE purchases|Intangible purchases/.test(
          name,
        )
      )
        continue;
      for (const [j, c] of contexts) {
        const cell = row[j];
        if (
          !cell ||
          cell === label ||
          financialNumberToken(cell.value) === null
        )
          continue;
        if (!monetaryMetric(name) && !/EPS/.test(name)) {
          reviews.push({
            section: t + 1,
            name,
            reason:
              "A ratio requires its own explicit unit; table monetary units cannot be substituted.",
          });
          continue;
        }
        const f = fact(
          name,
          cell.value,
          caption,
          c,
          yearEnd,
          t + 1,
          cell.locator,
          row.map((c) => c?.value ?? "").join(" | "),
          {
            financial_year_start: fyStart,
            financial_year_end: fyEnd,
            heading: label.value,
            table: t + 1,
          },
        );
        if (f) facts.push(f);
        else
          reviews.push({
            section: t + 1,
            name,
            reason:
              "Reporting context, unit or accounting scope failed validation.",
          });
      }
    }
  }
  return {
    format: "structured_html",
    facts,
    sections,
    reviews,
    calendar: {
      yearEndMonth: yearEnd,
      source: "Explicit financial-year start/end in filing metadata",
    },
    metadata: Object.fromEntries(meta),
  };
}
const taxonomy: Record<string, string> = {
  revenuefromoperations: "Revenue",
  revenue: "Revenue",
  profitlossbeforetax: "PBT",
  profitbeforetax: "PBT",
  profitlossforperiod: "PAT",
  profitloss: "PAT",
  assets: "Assets",
  equity: "Equity",
  liabilities: "Liabilities",
  cashandcashequivalents: "Cash and cash equivalents",
  currentassets: "Current assets",
  currentliabilities: "Current liabilities",
  inventories: "Inventory",
  cashflowsfromusedinoperatingactivities: "Operating cash flow",
  cashflowsfromusedininvestingactivities: "Investing cash flow",
  cashflowsfromusedinfinancingactivities: "Financing cash flow",
  basicearningslosspershare: "Basic EPS",
  dilutedearningslosspershare: "Diluted EPS",
  ebitda: "EBITDA",
  financecosts: "Finance costs",
  depreciationdepletionandamortisationexpense: "Depreciation and amortisation",
};
function xmlFacts(raw: string, company: { ticker: string; name: string }) {
  const dom = parseDocument(raw, {
    xmlMode: true,
    decodeEntities: true,
    withStartIndices: true,
  });
  const nodes = DomUtils.findAll(() => true, dom.children),
    meta = new Map<string, string>();
  for (const n of nodes) {
    const k = local(n.name),
      named = key(n.attribs.name?.split(":").at(-1) ?? k);
    if (
      [
        "nameofcompany",
        "companyname",
        "nsesymbol",
        "symbol",
        "dateofendoffinancialyear",
        "dateofstartoffinancialyear",
      ].includes(named)
    )
      meta.set(named, text(n));
  }
  assertCompany(meta, company);
  const end = date(meta.get("dateofendoffinancialyear") ?? "");
  if (!end)
    throw Error(
      "reporting_period_unresolved: XBRL financial-year end is not verified.",
    );
  const yearEnd = new Date(end).getUTCMonth() + 1,
    contexts = new Map<string, Context>();
  for (const n of nodes.filter((n) => local(n.name) === "context")) {
    const children = DomUtils.findAll(() => true, n.children);
    const value = (tag: string) => children.find((n) => local(n.name) === tag);
    const instant = value("instant"),
      end = value("enddate"),
      start = value("startdate"),
      dimensions = children
        .filter((n) => /member$/.test(local(n.name)))
        .map(text)
        .join(" ");
    const ending = date(text(instant ?? end ?? n));
    if (
      /standalone|separate/i.test(dimensions) ===
      /consolidated/i.test(dimensions)
    )
      continue;
    const scope = /standalone|separate/i.test(dimensions)
      ? "Standalone"
      : /consolidated/i.test(dimensions)
        ? "Consolidated"
        : "";
    if (ending && scope)
      contexts.set(n.attribs.id, {
        start: start ? date(text(start)) : null,
        end: ending,
        scope,
        kind: instant ? "instant" : "duration",
      });
  }
  const units = new Map<string, string>();
  for (const n of nodes.filter((n) => local(n.name) === "unit")) {
    const measures = DomUtils.findAll(
      (e) => local(e.name) === "measure",
      n.children,
    ).map(text);
    if (measures.length === 1)
      units.set(n.attribs.id, measures[0].split(":").at(-1)!);
    else if (measures.length === 2 && /shares/i.test(measures[1]))
      units.set(n.attribs.id, measures[0].split(":").at(-1)! + "/share");
  }
  const facts: FinancialFact[] = [],
    sections: { page: number; text: string }[] = [],
    reviews: { section: number; name?: string; reason: string }[] = [];
  for (const n of nodes) {
    const tag = key((n.attribs.name ?? n.name).split(":").at(-1)!);
    const name = taxonomy[tag];
    if (!name) continue;
    const c = contexts.get(n.attribs.contextRef ?? n.attribs.contextref);
    const unit = units.get(n.attribs.unitRef ?? n.attribs.unitref);
    if (!c || !unit) continue;
    if (n.attribs["xsi:nil"] === "true") continue;
    const scale = Number(n.attribs.scale ?? 0);
    if (!Number.isInteger(scale) || Math.abs(scale) > 12) continue;
    const v = financialNumberToken(text(n));
    if (v === null) continue;
    const expanded = v * 10 ** scale * (n.attribs.sign === "-" ? -1 : 1),
      section = sections.length + 1;
    const evidence = `${n.attribs.name ?? n.name} | ${text(n)} | context ${n.attribs.contextRef ?? n.attribs.contextref} | ${c.start ?? "instant"} to ${c.end} | ${c.scope} | ${unit} | scale ${scale}`;
    const f = fact(
      name,
      String(expanded),
      unit,
      c,
      yearEnd,
      section,
      `fact ${n.attribs.id ?? n.attribs.name ?? n.name}; context ${n.attribs.contextRef ?? n.attribs.contextref}`,
      evidence,
      {
        tag: n.attribs.name ?? n.name,
        literal: text(n),
        scale,
        sign: n.attribs.sign ?? null,
        decimals: n.attribs.decimals ?? null,
      },
    );
    sections.push({ page: section, text: `${company.name}\n${evidence}` });
    if (f) facts.push(f);
    else
      reviews.push({
        section,
        name,
        reason: "Unsupported XBRL fact context or unit.",
      });
  }
  return {
    format: "xbrl",
    facts,
    sections,
    reviews,
    calendar: {
      yearEndMonth: yearEnd,
      source: "Explicit XBRL financial-year end",
    },
    metadata: Object.fromEntries(meta),
  };
}
export function parseStructuredFinancials(
  raw: string,
  company: { ticker: string; name: string },
) {
  if (raw.length > 2_000_000)
    throw Error(
      "unsupported_file_format: Structured financial source exceeds the two-million-character limit.",
    );
  if (/<!ENTITY\b/i.test(raw))
    throw Error(
      "source_verification_failed: Entity declarations are not accepted.",
    );
  // Parsers never execute scripts, resolve external entities or fetch referenced schemas.
  return /<(?:\w+:)?context\b/i.test(raw)
    ? xmlFacts(raw, company)
    : htmlFacts(raw, company);
}
