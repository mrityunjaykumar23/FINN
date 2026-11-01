import { classify, type Category } from "./domain.ts";

export const normalizeEvidence = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9%₹]+/g, " ")
    .trim();
const patterns: Partial<Record<Category, RegExp>> = {
  results: /revenue|profit|ebitda|financial results|margin/i,
  "M&A": /acqui|merger|demerger|transaction|consideration|stake/i,
  management_change: /resign|appoint|retir|chief|director|ceo|cfo|effective/i,
  credit_rating: /rating|outlook|upgrade|downgrade|reaffirm/i,
  capex: /capital expenditure|investment|capacity|plant|facility|commission/i,
  litigation: /penalty|litigation|fine|regulator|order|lawsuit/i,
  dividend: /dividend|record date|per share/i,
};
/** Source-derived scope, independent of editorial headlines. Distinct same-category events
 * can be scoped with separate exact source quotes; no model text enters identity. */
export function eventEvidence(
  text: string,
  category: Category,
  exactQuote?: string,
) {
  if (exactQuote) {
    if (
      !text
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .includes(exactQuote.normalize("NFKC").replace(/\s+/g, " "))
    )
      throw new Error(
        "Event quote must be an exact excerpt from the indexed source page.",
      );
    return exactQuote;
  }
  const sentences = [...text.matchAll(/[^.;]+(?:[.;]|$)/g)].filter((m) =>
    (patterns[category] ?? /./).test(m[0]),
  );
  if (!sentences.length) return text;
  const first = sentences[0],
    last = sentences.at(-1)!;
  return text.slice(first.index!, last.index! + last[0].length).trim();
}
export type EventAttributes = {
  amounts: { value: number; unit: string; quote: string }[];
  percentages: number[];
  action?: string;
  position?: string;
  effective_date?: string;
  capacities: { value: number; unit: string; quote: string }[];
  rating_action?: string;
  rating_labels: string[];
  magnitude_status: "verified_absolute" | "unknown";
  limitations: string[];
};
export function analyzeMateriality(category: Category, text: string) {
  const amounts = [
    ...text.matchAll(
      /(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr\.?|million|billion|lakh)\b/gi,
    ),
  ].map((m) => ({
    value: Number(m[1].replaceAll(",", "")),
    unit: `INR ${/^cr/i.test(m[2]) ? "crore" : m[2].toLowerCase()}`,
    quote: m[0],
  }));
  const percentages = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((m) =>
    Number(m[1]),
  );
  const action = text.match(
    /downgrad\w*|upgrad\w*|reaffirm\w*|affirmed|resign\w*|appoint\w*|completed|proposed|approved/i,
  )?.[0];
  const position = text.match(
    /chief (?:executive|financial) officer|managing director|\bCEO\b|\bCFO\b/i,
  )?.[0];
  const effective_date = text.match(
    /effective\s+(?:from\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
  )?.[1];
  const crore = amounts.map(
    (a) =>
      a.value *
      ({
        "INR crore": 1,
        "INR lakh": 0.01,
        "INR million": 0.1,
        "INR billion": 100,
      }[a.unit] ?? 0),
  );
  const largest = crore.length ? Math.max(...crore) : null;
  // Absolute monetary scale, never a claim about the issuer's relative size or price impact.
  let magnitude =
    largest === null
      ? 12.5
      : largest >= 10000
        ? 25
        : largest >= 1000
          ? 22
          : largest >= 100
            ? 17
            : largest >= 10
              ? 10
              : 5;
  if (category === "results" && percentages.length)
    magnitude = Math.min(25, 10 + Math.max(...percentages.map(Math.abs)) / 3);
  const severity =
    (
      {
        results: 28,
        "M&A": 30,
        litigation: 28,
        management_change: position ? 32 : 22,
        credit_rating: /downgrad/i.test(action ?? "")
          ? 32
          : /reaffirm/i.test(action ?? "")
            ? 10
            : 23,
        capex: 22,
        dividend: 12,
        fund_raise: 22,
        pledging: 24,
        unclassified: 8,
      } as Record<string, number>
    )[category] ?? 8;
  const reasons = [
    category === "management_change" && position
      ? `Management change involving ${position}${action ? ` (${action})` : ""}.`
      : `Source-linked ${category.replaceAll("_", " ")} disclosure.`,
    largest !== null
      ? `Largest explicit INR amount: ₹${largest.toLocaleString("en-IN")} crore; absolute scale only.`
      : "Financial magnitude is unknown; neutral magnitude weight applied.",
  ];
  if (action) reasons.push(`Disclosed action: ${action}.`);
  const capacities = [
    ...text.matchAll(/([\d,]+(?:\.\d+)?)\s*(MW|MWh|GW|MTPA)\b/g),
  ].map((m) => ({
    value: Number(m[1].replaceAll(",", "")),
    unit: m[2],
    quote: m[0],
  }));
  const rating_labels =
    category === "credit_rating"
      ? [
          ...text.matchAll(
            /\b(?:AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|A1[+]?|stable|positive|negative)\b/gi,
          ),
        ].map((m) => m[0])
      : [];
  const attributes: EventAttributes = {
    amounts,
    percentages,
    action,
    position,
    effective_date,
    capacities,
    rating_labels,
    rating_action: category === "credit_rating" ? action : undefined,
    magnitude_status: largest === null ? "unknown" : "verified_absolute",
    limitations: [
      "Amounts are absolute disclosed figures; no company-relative size or price effect is inferred.",
    ],
  };
  return { severity, magnitude, novelty: 5, evidence: 9, attributes, reasons };
}
export function categoryForEvent(headline: string, text: string) {
  const title = classify(headline);
  return title.category !== "unclassified" ? title : classify(text);
}
