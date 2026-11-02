export const categories = [
  "results",
  "M&A",
  "fund_raise",
  "management_change",
  "litigation",
  "insider_trading",
  "earnings_call",
  "investor_meetings",
  "credit_rating",
  "dividend",
  "bonus_split",
  "capex",
  "press_release",
  "postal_ballot",
  "agm_egm",
  "pledging",
  "unclassified",
] as const;
export type Category = (typeof categories)[number];
export type Point = {
  date: string;
  close: number;
  adjusted_close: number | null;
  volume: number;
};
export type Settings = {
  price_threshold: number;
  volume_multiplier: number;
  volume_lookback: number;
  min_priority: number;
  enabled_categories: string[];
  company_rules: Record<
    string,
    { price_threshold?: number; volume_multiplier?: number }
  >;
};
export const defaultSettings: Settings = {
  price_threshold: 3,
  volume_multiplier: 2,
  volume_lookback: 20,
  min_priority: 50,
  enabled_categories: [...categories],
  company_rules: {},
};
export type Evidence = {
  document_id: string;
  title: string;
  url: string;
  page: number;
  text: string;
  period: string;
};
export type Filing = {
  id: string;
  ticker: string;
  headline: string;
  date: string;
  date_precision: string;
  category: Category;
  summary: string;
  why: string;
  document_id: string;
  evidence_page: number;
  confidence: string;
  severity: number;
  magnitude: number;
  novelty: number;
  evidence: number;
  questions: string[];
  event_signature?: string;
  exchange_filing_id?: string;
  event_quote?: string;
  event_scope?: "explicit" | "page_category";
  canonical_event_id?: string;
  review_required?: boolean;
  review_reason?: string;
  source_provider?: string;
  publication_precision?: string;
  publication_timezone?: string;
  published_at?: string;
  materiality_attributes?: import("./event-analysis.ts").EventAttributes;
  materiality_reasons?: string[];
};
export type Metric = {
  id: string;
  ticker: string;
  name: string;
  value: number | null;
  period: string;
  unit: string;
  basis: string;
  document_id: string;
  page: number;
  verification_status?: string;
  evidence_text?: string;
  extraction_method?: string;
  currency?: string | null;
  scale?: string | null;
  fiscal_year?: number | null;
  fiscal_quarter?: number | null;
  reporting_status?: string;
  updated_at?: string;
  published_at?: string | null;
};
export type Guidance = {
  ticker: string;
  metric: string;
  period: string;
  basis: string;
  low: number;
  high: number;
  actual: number;
  actual_period: string;
  actual_basis: string;
  guidance_document: string;
  guidance_page: number;
  actual_document: string;
  actual_page: number;
  qualifier: string;
  id?: string;
  unit?: string;
  guidance_type?: string;
  revised?: boolean;
  superseded?: boolean;
};
export function percentChange(current: number | null, base: number | null) {
  if (
    current === null ||
    base === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(base)
  )
    return { value: null, reason: "Unavailable" };
  if (base === 0) return { value: null, reason: "Zero comparison base" };
  if (base < 0)
    return {
      value: null,
      reason: "Negative comparison base; inspect absolute change",
    };
  return { value: ((current - base) / base) * 100, reason: null };
}
export function ratio(a: number | null, b: number | null) {
  return a === null ||
    b === null ||
    b <= 0 ||
    !Number.isFinite(a) ||
    !Number.isFinite(b)
    ? null
    : a / b;
}
export function marketSummary(points: Point[], lookback = 20) {
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const latest = ordered.at(-1),
    previous = ordered.at(-2);
  if (!latest)
    return {
      close: null,
      change: null,
      relative_volume: null,
      date: null,
      baseline_sessions: 0,
    };
  const baseline = ordered.slice(-lookback - 1, -1);
  const average =
    baseline.length === lookback
      ? baseline.reduce((s, p) => s + p.volume, 0) / lookback
      : null;
  return {
    close: latest.close,
    change: previous
      ? percentChange(latest.adjusted_close, previous.adjusted_close).value
      : null,
    relative_volume: ratio(latest.volume, average),
    date: latest.date,
    baseline_sessions: baseline.length,
  };
}
export function evaluateMarket(
  ticker: string,
  points: Point[],
  settings: Settings,
) {
  const m = marketSummary(points, settings.volume_lookback),
    custom = settings.company_rules[ticker] ?? {};
  const items: {
    id: string;
    ticker: string;
    type: string;
    date: string | null;
    value: number;
    threshold: number;
    text: string;
  }[] = [];
  const p = custom.price_threshold ?? settings.price_threshold,
    v = custom.volume_multiplier ?? settings.volume_multiplier;
  if (m.change !== null && Math.abs(m.change) >= p)
    items.push({
      id: `${ticker}:${m.date}:price`,
      ticker,
      type: "price",
      date: m.date,
      value: m.change,
      threshold: p,
      text: `Adjusted daily close moved ${m.change.toFixed(2)}%; your threshold is ±${p}%.`,
    });
  if (m.relative_volume !== null && m.relative_volume >= v)
    items.push({
      id: `${ticker}:${m.date}:volume`,
      ticker,
      type: "volume",
      date: m.date,
      value: m.relative_volume,
      threshold: v,
      text: `Volume was ${m.relative_volume.toFixed(2)}× the previous ${settings.volume_lookback} sessions; your threshold is ${v}×.`,
    });
  return items;
}
export function classify(text: string): {
  category: Category;
  confidence: string;
  rationale: string;
} {
  const rules: [Category, RegExp][] = [
    [
      "unclassified",
      /(?:intimation|notice).{0,40}board meeting|board meeting.{0,40}(?:consider|scheduled)/i,
    ],
    [
      "management_change",
      /(?:ceo|cfo|chief executive|chief financial|managing director|director).{0,60}(?:resign|appoint|retir)|(?:resign|appoint).{0,60}(?:ceo|cfo|director)/i,
    ],
    [
      "litigation",
      /litigation|penalty|regulatory order|insolvency|lawsuit|fine imposed/i,
    ],
    ["M&A", /acquisition|merger|demerger|joint venture|acquire a stake/i],
    [
      "earnings_call",
      /earnings.{0,20}call|conference call|transcript|concall/i,
    ],
    [
      "results",
      /financial results|quarterly results|annual results|audited results/i,
    ],
    [
      "fund_raise",
      /rights issue|fund.?rais|preferential allot|buyback|debenture|commercial paper|qualified institutional/i,
    ],
    ["insider_trading", /insider|promoter.{0,30}(?:buy|sell|transaction)/i],
    [
      "credit_rating",
      /credit rating|rating.{0,20}(?:upgrade|downgrade|reaffirm)/i,
    ],
    ["dividend", /dividend/i],
    ["bonus_split", /bonus issue|stock split|split of shares/i],
    [
      "capex",
      /capacity expansion|new plant|capital expenditure|new facility|commercial operation|declared commercial|commissioning/i,
    ],
    ["postal_ballot", /postal ballot/i],
    ["agm_egm", /annual general meeting|extraordinary general meeting/i],
    ["pledging", /pledg/i],
    ["investor_meetings", /investor meet|investor conference|analyst meet/i],
    ["press_release", /press release|order win|partnership|product launch/i],
  ];
  for (const [category, re] of rules)
    if (re.test(text))
      return {
        category,
        confidence: "medium",
        rationale: `Matched disclosure language: “${text.match(re)?.[0]}”. Verify against the filing.`,
      };
  return {
    category: "unclassified",
    confidence: "low",
    rationale: "No reliable category match; requires review.",
  };
}
export function rank(
  f: Filing,
  settings: Settings,
  weights = {
    severity: 40,
    magnitude: 25,
    relevance: 15,
    novelty: 10,
    evidence: 10,
  },
) {
  const parts = {
    severity: Math.min(weights.severity, Math.max(0, f.severity)),
    magnitude: Math.min(weights.magnitude, Math.max(0, f.magnitude)),
    relevance: settings.enabled_categories.includes(f.category)
      ? weights.relevance
      : 0,
    novelty: Math.min(weights.novelty, Math.max(0, f.novelty)),
    evidence: Math.min(weights.evidence, Math.max(0, f.evidence)),
  };
  const score = Math.min(
    100,
    Object.values(parts).reduce((a, b) => a + b, 0),
  );
  return {
    ...f,
    score,
    breakdown: parts,
    priority:
      score >= 75
        ? "Critical"
        : score >= 50
          ? "Important"
          : score >= 25
            ? "Watch"
            : "Routine",
  };
}
export function inWindow(date: string, start: string, end: string) {
  return (
    date.slice(0, 10) >= start.slice(0, 10) &&
    date.slice(0, 10) <= end.slice(0, 10)
  );
}
export function compareGuidance(g: Guidance) {
  if (g.guidance_type === "approximate")
    return {
      status: "Approximate target — review evidence",
      variance: null,
      explanation:
        "Approximate wording does not establish an exact pass/fail boundary. Inspect both sources and qualifiers.",
    };
  if (
    g.period !== g.actual_period ||
    g.basis !== g.actual_basis ||
    ![g.low, g.high, g.actual].every(Number.isFinite) ||
    g.low > g.high
  )
    return {
      status: "Insufficient comparable evidence",
      variance: null,
      explanation: !Number.isFinite(g.actual)
        ? "No verified actual on the same period, unit and accounting basis is available."
        : "The periods or accounting definitions do not align.",
    };
  const variance =
    g.actual < g.low && g.guidance_type !== "maximum"
      ? g.actual - g.low
      : g.actual > g.high && g.guidance_type !== "minimum"
        ? g.actual - g.high
        : 0;
  const unit = g.unit ?? "%",
    suffix = unit === "%" ? "%" : ` ${unit}`,
    difference = unit === "%" ? "percentage points" : unit;
  return {
    status:
      variance < 0
        ? "Below guidance"
        : variance > 0
          ? "Above guidance"
          : "Within guidance",
    variance,
    explanation:
      variance < 0
        ? `Reported ${g.actual}${suffix} was ${Math.abs(variance).toFixed(1)} ${difference} below the ${g.low}${suffix} lower bound.`
        : variance > 0
          ? `Reported ${g.actual}${suffix} was ${variance.toFixed(1)} ${difference} above the ${g.high}${suffix} upper bound.`
          : `Reported ${g.actual}${suffix} was ${g.guidance_type === "minimum" ? "at or above the stated minimum" : g.guidance_type === "maximum" ? "at or below the stated maximum" : `within the ${g.low}–${g.high}${suffix} guidance range`}.`,
  };
}
export function normalizeTicker(raw: string) {
  const t = raw.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9&-]{0,24}(?:\.(?:NS|BO))?$/.test(t))
    throw new Error("Enter a valid NSE ticker, such as ASIANPAINT.NS.");
  return /\.(NS|BO)$/.test(t) ? t : `${t}.NS`;
}
const synonyms: Record<string, string[]> = {
  pat: ["pat", "net profit", "profit after tax"],
  pbt: ["pbt", "profit before tax"],
  cfo: ["cfo", "cash from operations", "operating cash flow"],
  fcf: ["fcf", "free cash flow"],
  capex: ["capex", "capital expenditure", "purchase of property"],
  ebitda: ["ebitda", "operating profitability"],
  qoq: ["qoq", "quarter over quarter", "sequential"],
  yoy: ["yoy", "year over year"],
  cash: ["cash", "flow", "conversion", "operations", "capital", "expenditure"],
  guidance: ["guidance", "outlook", "expect", "growth", "margin"],
  risk: [
    "risk",
    "uncertainty",
    "headwind",
    "competition",
    "litigation",
    "contingent",
  ],
  debt: ["debt", "borrowings", "lease", "liabilities", "equity"],
  revenue: ["revenue", "revenues", "growth", "sales", "segments"],
  margin: ["margin", "profit", "ebit", "ebitda", "profitability"],
};
export function retrievalTerms(question: string) {
  const words = question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const filtered = words.filter(
    (w) =>
      w.length > 2 &&
      ![
        "the",
        "what",
        "how",
        "has",
        "was",
        "were",
        "does",
        "and",
        "for",
        "company",
        "its",
      ].includes(w),
  );
  return [...new Set(filtered.flatMap((w) => synonyms[w] ?? [w]))];
}
export function retrieve<
  T extends { ticker: string; text: string; period?: string; type?: string },
>(
  items: T[],
  ticker: string,
  question: string,
  filters: { period?: string; type?: string } = {},
  limit = 5,
) {
  const terms = retrievalTerms(question);
  return items
    .filter(
      (x) =>
        x.ticker === ticker &&
        (!filters.period || x.period === filters.period) &&
        (!filters.type || x.type === filters.type),
    )
    .map((x) => ({
      ...x,
      relevance: terms.reduce(
        (s, t) =>
          s +
          Math.min(
            5,
            (
              x.text
                .toLowerCase()
                .match(
                  new RegExp(
                    `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                    "g",
                  ),
                ) ?? []
            ).length,
          ),
        0,
      ),
    }))
    .filter((x) => x.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .filter((item, index, ordered) => {
      const value = item as T & { document_id?: string; page?: number };
      return (
        !value.document_id ||
        !value.page ||
        !ordered.slice(0, index).some((previous) => {
          const p = previous as T & { document_id?: string; page?: number };
          return p.document_id === value.document_id && p.page === value.page;
        })
      );
    })
    .slice(0, limit);
}
