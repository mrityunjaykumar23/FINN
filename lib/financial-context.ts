import { financialUnit } from "./financial-units.ts";
export type FinancialContext = {
  basis: "Consolidated" | "Standalone";
  page: number;
  quote: string;
};
/** Explicit presentation section headers may scope following pages; a competing entity clears them. */
export function financialContexts(
  pages: { page: number; text: string }[],
  ticker: string,
) {
  const result = new Map<number, FinancialContext>();
  let current: FinancialContext | null = null;
  const symbol = ticker.replace(/\.NS$/i, "");
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    const top = p.text.slice(0, 450),
      entity = top.match(
        /\b([A-Z][A-Z&.-]{2,14})\s+(?:Consolidated|Standalone)\b/,
      );
    if (entity && entity[1] !== symbol) current = null;
    const con = /\bconsolidated\b/i.test(top),
      stand = /\bstandalone\b/i.test(top);
    if (
      con !== stand &&
      ((p.text.length < 900 &&
        /financial\s+(?:highlights|statements|results|performance)/i.test(
          top,
        )) ||
        (p.page <= 3 &&
          p.text.length < 3000 &&
          /table of contents/i.test(top) &&
          /P&L|financial|balance sheet/i.test(p.text))) &&
      (!entity || entity[1] === symbol)
    )
      current = {
        basis: con ? "Consolidated" : "Standalone",
        page: p.page,
        quote: p.text.trim(),
      };
    if (
      /(?:subsidiary financial|segment financial|standalone financial)/i.test(
        top,
      ) &&
      current?.basis === "Consolidated" &&
      !con
    )
      current = null;
    if (current && !entity) result.set(p.page, current);
    else if (current && entity?.[1] === symbol) result.set(p.page, current);
  }
  return result;
}
export function explicitFinancialPeriod(text: string) {
  const top = text.slice(0, 450),
    q = top.match(/\b(Q[1-4]|H[12])\s*FY\s*['’]?(\d{2,4})\b/i);
  if (q)
    return `${q[1].toUpperCase()} FY${Number(q[2]) < 100 ? 2000 + Number(q[2]) : q[2]}`;
  return null;
}
export function sameFinancialUnit(claimed: string, evidence: string) {
  const a = financialUnit(claimed),
    b = financialUnit(evidence);
  return !!a && !!b && a.currency === b.currency && a.scale === b.scale;
}
