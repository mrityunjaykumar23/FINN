/** Retrieval synonyms do not establish accounting equivalence. */
export function financialLabelSupported(name: string, excerpt: string) {
  const text = excerpt.toLowerCase().replace(/\s+/g, " ");
  if (name === "Revenue") return /\brevenue\b|\bsales\b/.test(text);
  if (name === "Total income") return /total income/.test(text);
  if (name === "Operating margin")
    return /operating margin|\bebit margin/.test(text);
  if (name === "EBITDA margin") return /ebitda margin/.test(text);
  if (name === "Borrowings") return /borrowings/.test(text);
  return true;
}
