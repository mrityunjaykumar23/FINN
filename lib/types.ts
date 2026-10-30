import type {
  Filing,
  Point,
  Settings,
  Evidence,
  Metric,
  Guidance,
} from "./domain";
export type Company = {
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
};
export type Research = {
  ticker: string;
  question: string;
  summary: string;
  key_findings: { text: string; source_ids: string[]; excerpt?: boolean }[];
  metrics: Metric[];
  source_references: (Evidence & { id: string })[];
  limitations: string[];
  confidence: string;
  engine: string;
  cached?: boolean;
};
export type GuidanceResult = Guidance & {
  status: string;
  variance: number | null;
  explanation: string;
  sources: Evidence[];
};
export type Digest = {
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
