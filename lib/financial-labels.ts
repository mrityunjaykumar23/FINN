/** Retrieval synonyms do not establish accounting equivalence. */
export function financialLabelSupported(name: string, excerpt: string) {
  const text = excerpt.toLowerCase().replace(/\s+/g, " ");
  if (name === "Revenue") return /\brevenues?\b|\bsales\b/.test(text);
  if (name === "Total income") return /total income/.test(text);
  if (name === "Operating margin")
    return /operating margin|\bebit margin/.test(text);
  if (name === "EBITDA margin") return /ebitda margin/.test(text);
  if (name === "Borrowings") return /borrowings/.test(text);
  return true;
}
/** Recover an omitted adjacent heading, without crossing another financial measure. */
export function revenueContext(page: string, quote: string) {
  const text = page.replace(/\s+/g, " "),
    q = quote.replace(/\s+/g, " "),
    at = text.indexOf(q);
  if (at < 0 || /total income|other income/i.test(q)) return;
  const before = text.slice(Math.max(0, at - 350), at),
    labels = [...before.matchAll(/\brevenues?\b|\bsales\b/gi)];
  const label = labels.at(-1);
  if (!label) return;
  const between = before.slice(label.index! + label[0].length);
  if (
    /income|profit|EBITDA|\bPAT\b|\bPBT\b|cash flow|debt|borrowings/i.test(
      between,
    )
  )
    return;
  return before.slice(label.index!) + q;
}
