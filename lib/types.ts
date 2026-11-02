import type {
  Filing,
  Point,
  Settings,
  Evidence,
  Metric,
  Guidance,
} from "./domain";
export type Company = {
  market_freshness?: ReturnType<typeof import("./market-state").marketFreshness>;
  prior_sessions?: number;
  relative_volume_status?: string;
  ticker: string;
  name: string;
  sector: string;
  validation: string;
  updated_at?: string;
  close: number | null;
  change: number | null;
  relative_volume: number | null;
  date: string | null;
  events: number;
  in_portfolio?: number;
  indexed_documents?: number;
  exchange?: string;
  points?: Point[];
};
export type RankedFiling = Filing & {
  score: number;
  priority: string;
  breakdown: Record<string, number>;
  source_url: string;
  company_name: string;
  evidence_text?: string;
  metrics?: Metric[];
  supporting_sources?: Evidence[];
  metric_source_urls?: Record<string, string>;
};
export type Document = {
  id: string;
  ticker: string;
  title: string;
  type: string;
  period: string;
  url: string;
  published_at: string | null;
  retrieved_at: string;
  hash: string;
  mode: string;
  pages: { page: number; text: string }[];
  publisher?: string;
  extraction_status?: string;
  indexed_pages?: number;
  total_pages?: number;
  period_status?: string;
  financial_extraction_status?: string | null;
  financial_extraction_error?: string | null;
};
export type Research = {
  ticker: string;
  question: string;
  summary: string;
  key_findings: ResearchFinding[];
  metrics: Metric[];
  source_references: (Evidence & { id: string })[];
  limitations: string[];
  confidence: string;
  engine: string;
  cached?: boolean;
  ai_status?: string;
  model_used?: string;
  generated_at?: string;
  confidence_basis?: string;
  usage?: { input_tokens: number; output_tokens: number };
  management_commentary?: ResearchFinding[];
  risks?: ResearchFinding[];
  positive_factors?: ResearchFinding[];
};
export type ResearchFinding = {
  evidence_type?:
    | "reported"
    | "commentary"
    | "risk"
    | "positive"
    | "calculated";
  text: string;
  source_ids: string[];
  excerpt?: boolean;
  evidence_excerpt?: string;
  uncertainty_note?: string;
  verification?: string;
};
export type GuidanceResult = Guidance & {
  stated_at?: string | null;
  status: string;
  variance: number | null;
  explanation: string;
  sources: Evidence[];
};
export type Digest = {
  important_count: number;
  routine_count: number;
  companies_with_events: number;
  monitored_companies: number;
  successfully_checked_companies: number;
  last_successful_announcement_check: string | null;
  unavailable_source_companies: string[];
  never_configured_companies: string[];
  next_cursor: string | null;
  next_routine_cursor: string | null;
  mode: string;
  start: string;
  end: string;
  events: RankedFiling[];
  routine: RankedFiling[];
  market_alerts: {
    id: string;
    ticker: string;
    type: string;
    date: string;
    value: number;
    threshold: number;
    text: string;
  }[];
  total: number;
  companies: number;
  covered_companies: number;
  unavailable_companies: number;
  source_note: string;
};
export type { Settings, Evidence, Metric };
