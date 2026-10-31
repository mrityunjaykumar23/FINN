import { z } from "zod";
import { categories, type Metric } from "../domain.ts";
import { AiFailure, type Transport } from "./gemini.ts";

export type Source = {
  id: string;
  document_id: string;
  ticker: string;
  page: number;
  text: string;
  period: string;
  basis?: string;
};
export const findingSchema = z.object({
  claim: z.string().min(1).max(1800),
  supporting_source_ids: z.array(z.string()).min(1).max(4),
  evidence_excerpt: z.string().min(16).max(2500),
  evidence_type: z.enum([
    "reported",
    "commentary",
    "risk",
    "positive",
    "calculated",
  ]),
  uncertainty_note: z.string().max(500).default(""),
});
export const researchSchema = z.object({
  ticker: z.string(),
  question: z.string(),
  concise_summary: findingSchema,
  findings: z.array(findingSchema).max(10),
  management_commentary: z.array(findingSchema).max(5),
  risks: z.array(findingSchema).max(5),
  positive_factors: z.array(findingSchema).max(5),
  limitations: z.array(z.string()).max(12),
  confidence_basis: z.string().max(800),
});
const fjson = {
  type: "object",
  properties: {
    claim: { type: "string" },
    supporting_source_ids: { type: "array", items: { type: "string" } },
    evidence_excerpt: { type: "string" },
    evidence_type: {
      type: "string",
      enum: ["reported", "commentary", "risk", "positive", "calculated"],
    },
    uncertainty_note: { type: "string" },
  },
  required: [
    "claim",
    "supporting_source_ids",
    "evidence_excerpt",
    "evidence_type",
    "uncertainty_note",
  ],
};
export const researchJson = {
  type: "object",
  properties: {
    ticker: { type: "string" },
    question: { type: "string" },
    concise_summary: fjson,
    findings: { type: "array", items: fjson },
    management_commentary: { type: "array", items: fjson },
    risks: { type: "array", items: fjson },
    positive_factors: { type: "array", items: fjson },
    limitations: { type: "array", items: { type: "string" } },
    confidence_basis: { type: "string" },
  },
  required: [
    "ticker",
    "question",
    "concise_summary",
    "findings",
    "management_commentary",
    "risks",
    "positive_factors",
    "limitations",
    "confidence_basis",
  ],
};
const clean = (s: string) =>
  s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const numbers = (s: string) =>
  s
    .replace(/\bS\d+\b/g, "")
    .replace(/,/g, "")
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map(Number) ?? [];
export function verifyFinding(
  f: z.infer<typeof findingSchema>,
  ticker: string,
  sources: Source[],
  metrics: Metric[],
  calculated: string[] = [],
) {
  const refs = f.supporting_source_ids.map((id) =>
    sources.find((s) => s.id === id && s.ticker === ticker),
  );
  if (
    refs.some((s) => !s) ||
    !refs.some((s) => clean(s!.text).includes(clean(f.evidence_excerpt)))
  )
    return false;
  if (
    /ignore (?:all |previous )?instructions|reveal.{0,20}(?:key|secret)|system prompt/i.test(
      f.claim,
    )
  )
    return false;
  // A cited ID is insufficient: require a literal excerpt, lexical relationship, and supported numbers.
  const words = clean(f.claim).match(/[a-z]{4,}/g) ?? [];
  const evidence = clean(refs.map((s) => s!.text).join(" "));
  const meaningful = words.filter(
    (w) =>
      ![
        "company",
        "reported",
        "financial",
        "during",
        "period",
        "according",
        "source",
        "evidence",
      ].includes(w),
  );
  if (
    meaningful.length &&
    meaningful.filter((w) => evidence.includes(w)).length / meaningful.length <
      0.35
  )
    return false;
  const citedMetrics = metrics.filter(
    (m) =>
      m.ticker === ticker &&
      m.verification_status !== "unverified" &&
      refs.some((s) => s!.document_id === m.document_id && s!.page === m.page),
  );
  const allowed = [
    ...numbers(f.evidence_excerpt),
    ...citedMetrics.flatMap((m) => numbers(`${m.value ?? ""} ${m.period}`)),
  ];
  if (f.evidence_type === "calculated") {
    // Calculated claims must reproduce a deterministic finding, not a model's arithmetic.
    if (!calculated.some((c) => clean(c) === clean(f.claim))) return false;
    return true;
  }
  if (
    numbers(f.claim.replace(/(?:Q[1-4]\s*)?FY\s*['’]?\d{2,4}/gi, "")).some(
      (n) => !allowed.some((a) => Math.abs(a - n) < 1e-8),
    )
  )
    return false;
  // An explicit period in the claim must appear on the cited passage or its verified metadata.
  const periods = f.claim.match(/(?:Q[1-4]\s*)?FY\s*['’]?\d{2,4}/gi) ?? [];
  const canonicalPeriod = (text: string) =>
    clean(text)
      .replace(
        /fy\s*['’]?\s*(\d{2,4})/g,
        (_, year) => `fy${Number(year) < 100 ? 2000 + Number(year) : year}`,
      )
      .replace(/q([1-4])\s+fy/g, "q$1fy");
  if (
    periods.some(
      (p) =>
        !refs.some((s) =>
          canonicalPeriod(s!.text + " " + s!.period).includes(
            canonicalPeriod(p),
          ),
        ),
    )
  )
    return false;
  return true;
}
export async function analyzeCompanyResearch(
  transport: Transport,
  model: string,
  input: {
    ticker: string;
    question: string;
    sources: Source[];
    metrics: Metric[];
    calculated: string[];
  },
) {
  const response = await transport({
    model,
    task: "Answer the research question. Cover business, financial snapshot, trajectory, balance sheet, cash quality, narrative, guidance and bull/bear only as relevant and supported. State uncovered sections. Use concise analyst prose. No price forecasts.",
    data: input,
    schema: researchJson,
  });
  const parsed = researchSchema.safeParse(JSON.parse(response.text));
  if (!parsed.success || parsed.data.ticker !== input.ticker)
    throw new AiFailure("invalid_schema_or_company");
  const answer = parsed.data;
  const valid = (f: z.infer<typeof findingSchema>) =>
    verifyFinding(
      f,
      input.ticker,
      input.sources,
      input.metrics,
      input.calculated,
    );
  const validSummary = valid(answer.concise_summary);
  const before =
    answer.findings.length +
    answer.risks.length +
    answer.positive_factors.length +
    answer.management_commentary.length;
  answer.findings = answer.findings.filter(valid);
  answer.risks = answer.risks.filter(valid);
  answer.positive_factors = answer.positive_factors.filter(valid);
  answer.management_commentary = answer.management_commentary.filter(valid);
  if (!validSummary) {
    const substitute =
      answer.findings[0] ??
      answer.management_commentary[0] ??
      answer.risks[0] ??
      answer.positive_factors[0];
    if (!substitute) throw new AiFailure("unsupported_summary");
    answer.concise_summary = substitute;
    answer.limitations.push(
      "The original model summary failed evidence checks. A supported model finding is shown as the summary.",
    );
  }
  const after =
    answer.findings.length +
    answer.risks.length +
    answer.positive_factors.length +
    answer.management_commentary.length;
  if (before > after)
    answer.limitations.push(
      `${before - after} unsupported model claims were omitted by evidence checks.`,
    );
  return {
    ...answer,
    usage: {
      input_tokens: response.inputTokens,
      output_tokens: response.outputTokens,
    },
  };
}

export const metricExtraction = z.object({
  name: z.enum([
    "Revenue",
    "EBITDA",
    "PBT",
    "PAT",
    "Operating cash flow",
    "Free cash flow",
    "Debt",
    "Borrowings",
    "Equity",
    "Capex",
    "Operating margin",
    "Revenue growth",
  ]),
  value: z.number().finite(),
  period: z.string().regex(/^(?:Q[1-4] )?FY\d{4}$/),
  unit: z.string().min(1),
  basis: z.string().min(4),
  source_id: z.string(),
  evidence_excerpt: z.string().min(16),
  value_text: z.string().min(1),
});
export const guidanceExtraction = z.object({
  metric: z.string().min(2),
  guidance_type: z.enum([
    "range",
    "minimum",
    "maximum",
    "target",
    "approximate",
  ]),
  target_min: z.number().nullable(),
  target_max: z.number().nullable(),
  unit: z.string().min(1),
  basis: z.string().min(4),
  stated_at: z.string().nullable(),
  target_period: z.string().regex(/^(?:Q[1-4] )?FY\d{4}$/),
  source_id: z.string(),
  evidence_excerpt: z.string().min(16),
  qualifiers: z.string(),
});
export const extractionSchema = z.object({
  metrics: z.array(metricExtraction).max(60),
  guidance: z.array(guidanceExtraction).max(15),
});
const string = { type: "string" },
  nullableNumber = { type: ["number", "null"] };
const metricJson = {
  type: "object",
  properties: {
    name: { type: "string", enum: metricExtraction.shape.name.options },
    value: { type: "number" },
    period: string,
    unit: string,
    basis: string,
    source_id: string,
    evidence_excerpt: string,
    value_text: string,
  },
  required: Object.keys(metricExtraction.shape),
};
const guidanceJson = {
  type: "object",
  properties: {
    metric: string,
    guidance_type: {
      type: "string",
      enum: guidanceExtraction.shape.guidance_type.options,
    },
    target_min: nullableNumber,
    target_max: nullableNumber,
    unit: string,
    basis: string,
    stated_at: { type: ["string", "null"] },
    target_period: string,
    source_id: string,
    evidence_excerpt: string,
    qualifiers: string,
  },
  required: Object.keys(guidanceExtraction.shape),
};
export async function extractFinancialMetrics(
  transport: Transport,
  model: string,
  ticker: string,
  sources: Source[],
) {
  const response = await transport({
    model,
    task: "Extract at most 12 explicitly reported financial values and 3 explicit quantified forward guidance statements. Prioritize current quarter revenue, EBITDA, PBT and PAT plus prior quarter and prior-year comparable values, only where reported. Copy short exact excerpts (at most 350 characters) and value_text. Periods MUST use Q4 FY2025 or FY2025 format with four-digit ending year, and only if unambiguous. Include currency/scale in unit and consolidated/standalone plus accounting standard and constant/reported currency in basis. Never derive EBITDA or invent missing facts. Exclude vague optimism. Basis must be supported in the page. Return empty arrays for uncertain facts.",
    data: { ticker, sources },
    schema: {
      type: "object",
      properties: {
        metrics: { type: "array", items: metricJson },
        guidance: { type: "array", items: guidanceJson },
      },
      required: ["metrics", "guidance"],
    },
  });
  const raw = z
    .object({
      metrics: z.array(z.unknown()).max(60),
      guidance: z.array(z.unknown()).max(15),
    })
    .parse(JSON.parse(response.text));
  const parsed = {
    metrics: raw.metrics.flatMap((m) => {
      const p = metricExtraction.safeParse(m);
      return p.success ? [p.data] : [];
    }),
    guidance: raw.guidance.flatMap((g) => {
      const p = guidanceExtraction.safeParse(g);
      return p.success ? [p.data] : [];
    }),
  };
  const acceptedMetrics = parsed.metrics.filter((m) => {
    if (
      /(?:9M|6M)\s*FY|nine.months|six.months|half.year/i.test(
        m.evidence_excerpt,
      )
    )
      return false;
    const s = sources.find((s) => s.id === m.source_id && s.ticker === ticker);
    if (
      !s ||
      !clean(s.text).includes(clean(m.evidence_excerpt)) ||
      !clean(m.evidence_excerpt).includes(clean(m.value_text))
    )
      return false;
    if (!numbers(m.value_text).some((n) => n === m.value)) return false;
    const context = clean(s.text);
    if (/consolidated/i.test(m.basis) && !context.includes("consolidated"))
      return false;
    if (/standalone/i.test(m.basis) && !context.includes("standalone"))
      return false;
    if (/crore/i.test(m.unit) && !context.includes("crore")) return false;
    if (/million/i.test(m.unit) && !context.includes("million")) return false;
    return true;
  });
  const acceptedGuidance = parsed.guidance.filter((g) => {
    const s = sources.find((s) => s.id === g.source_id && s.ticker === ticker);
    if (
      !s ||
      !clean(s.text).includes(clean(g.evidence_excerpt)) ||
      !/guidance|expect|target|outlook|project|plan|budget/i.test(
        g.evidence_excerpt,
      )
    )
      return false;
    if (g.target_min === null && g.target_max === null) return false;
    if (
      g.target_min !== null &&
      g.target_max !== null &&
      g.target_min > g.target_max
    )
      return false;
    return [g.target_min, g.target_max]
      .filter((n) => n !== null)
      .every((n) => numbers(g.evidence_excerpt).includes(n!));
  });
  return {
    metrics: acceptedMetrics,
    guidance: acceptedGuidance,
    usage: {
      input_tokens: response.inputTokens,
      output_tokens: response.outputTokens,
    },
    rejected:
      raw.metrics.length +
      raw.guidance.length -
      acceptedMetrics.length -
      acceptedGuidance.length,
  };
}
export const extractManagementGuidance = extractFinancialMetrics;
export const compareManagementNarrative = analyzeCompanyResearch;
export const generateBullBearAnalysis = analyzeCompanyResearch;
export async function classifyAnnouncement(
  transport: Transport,
  model: string,
  ticker: string,
  sources: Source[],
) {
  const schema = z.object({
    category: z.enum(categories),
    summary: findingSchema,
    why_it_matters: findingSchema,
    confidence: z.number().min(0).max(1),
  });
  const response = await transport({
    model,
    task: "Classify the filing into one supplied category; use unclassified if ambiguous. Summarize the change and explain attention relevance without predictions. Both statements require exact supporting excerpts.",
    data: { ticker, sources, categories },
    schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: categories },
        summary: fjson,
        why_it_matters: fjson,
        confidence: { type: "number" },
      },
      required: ["category", "summary", "why_it_matters", "confidence"],
    },
  });
  const value = schema.parse(JSON.parse(response.text));
  if (
    !verifyFinding(value.summary, ticker, sources, []) ||
    !verifyFinding(value.why_it_matters, ticker, sources, [])
  )
    throw new AiFailure("unsupported_classification");
  return {
    ...value,
    usage: {
      input_tokens: response.inputTokens,
      output_tokens: response.outputTokens,
    },
  };
}
export const summarizeAnnouncement = classifyAnnouncement;
export const explainMateriality = classifyAnnouncement;
