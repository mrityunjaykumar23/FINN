import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { geminiTransport, aiStatus, type AiConfig } from "../lib/ai/gemini.ts";
import { analyzeCompanyResearch } from "../lib/ai/provider.ts";
const config: AiConfig = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL_FAST: process.env.GEMINI_MODEL_FAST,
  AI_ENABLED: process.env.AI_ENABLED,
};
if (existsSync(".dev.vars"))
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[2])
      config[m[1] as keyof AiConfig] = m[2].replace(/^['"]|['"]$/g, "");
  }
test(
  "real Gemini grounded research on an authentic Infosys source",
  {
    skip: !aiStatus(config).enabled
      ? "Gemini key/model not configured; credentialed acceptance remains pending"
      : false,
  },
  async () => {
    const seed = JSON.parse(readFileSync("data/seed.json", "utf8")),
      d = seed.documents.find((d: { id: string }) => d.id === "infy-results"),
      page = d.pages.find((p: { page: number }) => p.page === 1);
    const result = await analyzeCompanyResearch(
      geminiTransport(config),
      config.GEMINI_MODEL_FAST!,
      {
        ticker: "INFY.NS",
        question:
          "What constant-currency revenue growth did Infosys report for FY2025? Give a concise sourced answer.",
        sources: [
          {
            id: "S1",
            document_id: d.id,
            ticker: d.ticker,
            page: 1,
            text: page.text,
            period: d.period,
          },
        ],
        metrics: seed.metrics.filter(
          (m: { ticker: string }) => m.ticker === "INFY.NS",
        ),
        calculated: [],
      },
    );
    assert.ok(result.concise_summary.supporting_source_ids.includes("S1"));
    assert.match(result.concise_summary.claim, /4\.2/);
    assert.ok(result.usage.input_tokens > 0);
  },
);
