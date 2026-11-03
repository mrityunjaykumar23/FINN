import { type Category } from "./domain.ts";
const rules: Partial<Record<Category, RegExp>> = {
  results: /revenue|profit (?:after|before) tax|\bPAT\b|\bEBITDA\b/i,
  dividend:
    /\b(?:declar\w*|recommend\w*|propos\w*|approv\w*)\b.{0,100}\bdividend\b(?!\s+(?:income|received|paid))|\bdividend\b(?!\s+(?:income|received|paid)).{0,100}\b(?:declared|recommended|proposed|approved)\b/i,
  management_change:
    /(?:chief|CFO|CEO|director|managing).{0,140}(?:resign|appoint|retir|cessation)|(?:resign|appoint|retir|cessation).{0,140}(?:chief|CFO|CEO|director|managing)/i,
  "M&A":
    /(?:acqui\w*|merger|demerger|joint venture).{0,100}(?:complet|approv|propos|stake|consideration)|(?:complet|approv|propos).{0,100}(?:acqui|merger|demerger)/i,
  credit_rating:
    /rating.{0,130}(?:affirm|upgrade|downgrade|assign)|(?:affirm|upgrade|downgrade).{0,130}rating/i,
  capex:
    /commercial operation|declared commercial|capacity expansion|capital expenditure|commission\w*.{0,80}(?:plant|capacity|project)/i,
  litigation: /penalty|fine imposed|litigation|regulatory order/i,
};
export function supportsEvent(category: Category, text: string) {
  if (category === "unclassified") return true;
  return (
    rules[category] ?? new RegExp(category.replaceAll("_", "[ .-]"), "i")
  ).test(text.replace(/\s+/g, " "));
}
/** Financial notes often recap earlier transactions. Keep those for review unless
 * the disclosure's own title identifies a transaction announcement. */
export function automatedEventSupported(
  category: Category,
  text: string,
  headline: string,
) {
  if (!supportsEvent(category, text)) return false;
  if (
    category === "dividend" &&
    !/declar(?:ed|ation|e|es)|recommend(?:ed|ation|s)?|propos(?:ed|al|es?)|approv(?:ed|al|es?)/i.test(
      text.replace(/dividend income|dividends? paid|dividends? received/gi, ""),
    )
  )
    return false;
  if (
    category === "M&A" &&
    /financial|results/i.test(headline) &&
    !/acqui|merger|demerger|amalgamat|scheme|joint venture/i.test(headline)
  )
    return false;
  return true;
}
export type MatchedEvent = {
  category: Category;
  page: number;
  quote: string;
  headline: string;
};
export function matchFilingEvents(
  pages: { page: number; text: string }[],
  headline: string,
): MatchedEvent[] {
  const found: MatchedEvent[] = [];
  for (const [category, pattern] of Object.entries(rules) as [
    Category,
    RegExp,
  ][]) {
    if (
      !automatedEventSupported(
        category,
        pages.map((p) => p.text).join(" "),
        headline,
      )
    )
      continue;
    const scored = pages
      .filter((p) => supportsEvent(category, p.text))
      .map((p) => {
        const flat = p.text.replace(/\s+/g, " "),
          hits = [...flat.matchAll(new RegExp(pattern.source, "gi"))].length;
        const metrics = (
          flat.match(/revenue|profit|EBITDA|\bPAT\b|\bPBT\b/gi) ?? []
        ).length;
        return { p, score: hits + (category === "results" ? metrics * 3 : 0) };
      })
      .filter(
        (x) =>
          category !== "results" ||
          (/\d[\d,.]{2,}/.test(x.p.text) &&
            /quarter|year|FY\s*['’]?\d/i.test(x.p.text)),
      )
      .sort((a, b) => b.score - a.score || a.p.page - b.p.page);
    if (!scored.length) continue;
    const p = scored[0].p;
    const normalized = p.text.replace(/\s+/g, " "),
      hit = pattern.exec(normalized);
    if (!hit) continue;
    // Keep a real contiguous paragraph/window, never a stitched synthetic quotation.
    const rawMatch = new RegExp(
      pattern.source.replace(/\.\{0,\d+\}/g, "[\\s\\S]{0,180}"),
      "i",
    ).exec(p.text);
    const at = rawMatch?.index ?? 0,
      start = Math.max(0, p.text.lastIndexOf("\n\n", at)),
      end = p.text.indexOf("\n\n", at + 20);
    let quote = p.text
      .slice(start, end > start ? end : Math.min(p.text.length, start + 5000))
      .trim();
    if (!supportsEvent(category, quote))
      quote = p.text
        .slice(Math.max(0, at - 180), Math.min(p.text.length, at + 2200))
        .trim();
    if (
      quote.length < 20 ||
      !p.text.includes(quote) ||
      !supportsEvent(category, quote)
    )
      continue;
    found.push({
      category,
      page: p.page,
      quote,
      headline: `${category.replaceAll("_", " ")}: ${headline}`.slice(0, 240),
    });
  }
  if (!found.length) {
    const tokens = headline.toLowerCase().match(/[a-z]{5,}/g) ?? [];
    const page = pages.find(
      (p) =>
        tokens.filter((t) => p.text.toLowerCase().includes(t)).length >=
          Math.min(3, tokens.length) && tokens.length >= 2,
    );
    if (page)
      found.push({
        category: "unclassified",
        page: page.page,
        quote: page.text.slice(0, 3000),
        headline,
      });
  }
  return found.slice(0, 6);
}
