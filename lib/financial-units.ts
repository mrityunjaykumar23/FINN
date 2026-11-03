export type FinancialUnit = {
  currency: string | null;
  scale: string;
  unit: string;
  multiplier: number;
  normalized_unit: string;
  normalization_factor: number;
};
/** Unit conversion only. No FX conversion, assumed currency, or inferred reporting scale. */
export function financialUnit(
  raw: string,
  perShare = false,
): FinancialUnit | null {
  const text = raw.replace(/\u00a0/g, " ").trim();
  if (/^(?:%|percent(?:age)?)$/i.test(text))
    return {
      currency: null,
      scale: "percent",
      unit: "%",
      multiplier: 1,
      normalized_unit: "%",
      normalization_factor: 1,
    };
  if (/^(?:x|times|ratio)$/i.test(text))
    return {
      currency: null,
      scale: "ratio",
      unit: "x",
      multiplier: 1,
      normalized_unit: "x",
      normalization_factor: 1,
    };
  const currencies = [
    ...new Set(
      [
        ...text.matchAll(
          /\b(INR|USD|EUR|GBP|JPY|AED|CNY|CHF|AUD|CAD)\b|₹|\bRs\.?\b|\bRupees\b|US\s*\$/gi,
        ),
      ].map((m) =>
        /₹|rs\.?|rupees/i.test(m[0])
          ? "INR"
          : /US\s*\$/.test(m[0])
            ? "USD"
            : m[0].toUpperCase(),
      ),
    ),
  ];
  if (currencies.length !== 1) return null;
  const currency = currencies[0];
  if (
    perShare ||
    (!/\b(?:crores?|lakhs?|lacs?|millions?|billions?|thousands?)\b/i.test(
      text,
    ) &&
      /per\s+(?:equity\s+)?share|\/share/i.test(text))
  )
    return {
      currency,
      scale: "per_share",
      unit: `${currency}/share`,
      multiplier: 1,
      normalized_unit: `${currency}/share`,
      normalization_factor: 1,
    };
  const scales: [RegExp, string, number][] = [
    [/\b(?:crores?|crs?)\b/i, "crore", 1e7],
    [/\b(?:lakhs?|lacs?)\b/i, "lakh", 1e5],
    [/\b(?:millions?|mn)\b/i, "million", 1e6],
    [/\b(?:billions?|bn)\b/i, "billion", 1e9],
    [/\b(?:thousands?)\b/i, "thousand", 1e3],
  ];
  const found = scales.filter(([re]) => re.test(text));
  if (found.length > 1) return null;
  if (
    !found.length &&
    !/^(?:(?:amounts?\s+)?in\s+)?(?:INR|USD|EUR|GBP|JPY|AED|CNY|CHF|AUD|CAD|₹|Rs\.?|Rupees)[\s().]*$/i.test(
      text,
    )
  )
    return null;
  const [, scale, multiplier] = found[0] ?? [/./, "unit", 1];
  const normalizedScale = currency === "INR" ? "crore" : "million";
  return {
    currency,
    scale,
    unit: `${currency}${scale === "unit" ? "" : " " + scale}`,
    multiplier,
    normalized_unit: `${currency} ${normalizedScale}`,
    normalization_factor: multiplier / (currency === "INR" ? 1e7 : 1e6),
  };
}
export function normalizeFinancialValue(value: number, unit: FinancialUnit) {
  if (!Number.isFinite(value)) return null;
  // One deterministic rounding boundary avoids binary residue in scale conversions.
  return Number((value * unit.normalization_factor).toPrecision(15));
}
export function financialNumberToken(raw: string) {
  const s = raw.replace(/\u00a0/g, " ").trim();
  const negative = s.startsWith("(") && s.endsWith(")");
  if (s.includes("(") || s.includes(")")) {
    if (!negative || /[+−-]/.test(s)) return null;
  }
  const token = negative ? s.slice(1, -1) : s;
  if (
    !/^[+−-]?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(
      token,
    )
  )
    return null;
  const value =
    Number(token.replace(/,/g, "").replace("−", "-")) * (negative ? -1 : 1);
  return Number.isFinite(value) ? value : null;
}
