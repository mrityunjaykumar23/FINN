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
for (const scenario of ["guidance", "risk"] as const)
  test(
    `real Gemini ${scenario} analysis preserves authentic source evidence`,
    {
      skip: !aiStatus(config).enabled
        ? "Gemini key/model not configured"
        : false,
    },
    async () => {
      const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
      const d = seed.documents.find(
        (d: { id: string }) =>
          d.id === (scenario === "guidance" ? "hcl-results" : "infy-annual"),
      );
      const pages =
        scenario === "guidance"
          ? d.pages.filter((p: { page: number }) => p.page === 3)
          : [...d.pages]
              .sort(
                (a: { text: string }, b: { text: string }) =>
                  (
                    b.text.match(
                      /risk|cyber|security|uncertain|geopolitical/gi,
                    ) ?? []
                  ).length -
                  (
                    a.text.match(
                      /risk|cyber|security|uncertain|geopolitical/gi,
                    ) ?? []
                  ).length,
              )
              .slice(0, 3);
      const sources = pages.map(
        (p: { page: number; text: string }, i: number) => ({
          id: `S${i + 1}`,
          document_id: d.id,
          ticker: d.ticker,
          page: p.page,
          text: p.text.slice(0, 6000),
          period: d.period,
        }),
      );
      const result = await analyzeCompanyResearch(
        geminiTransport(config),
        config.GEMINI_MODEL_FAST!,
        {
          ticker: d.ticker,
          question:
            scenario === "guidance"
              ? "What company constant-currency revenue-growth and EBIT-margin guidance was given for FY2026? Preserve the forward-looking qualifiers."
              : "Identify the principal risks disclosed in these annual-report passages. Explain the uncertainties without predicting their outcomes.",
          sources,
          metrics: [],
          calculated: [],
        },
      );
      assert.ok(result.usage.input_tokens > 0);
      assert.ok(result.concise_summary.supporting_source_ids.length > 0);
      if (scenario === "guidance")
        assert.match(JSON.stringify(result), /2|5|18|19/);
      else assert.ok(result.risks.length > 0);
    },
  );
