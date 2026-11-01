import { all, one, run, budget } from "../db/repository";
import { parseNseDirectory } from "./company-directory";
import { fetchPublicDirectory } from "./ingestion/discovery";
import { resolveCompany } from "./server";
import type { Company } from "./types";
export async function searchCompanies(query: string, owner: string) {
  const q = query.trim(),
    normalized = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  let companies = await all<Company>(
    "SELECT * FROM companies WHERE instr(lower(ticker),lower(?))>0 OR instr(lower(name),lower(?))>0 OR instr(replace(replace(replace(lower(name),' ',''),'&',''),'.',''),?)>0 ORDER BY name LIMIT 12",
    q,
    q,
    normalized,
  );
  let limitation: string | undefined;
  if (!companies.length && q) {
    await budget("global:resolve", 60);
    if (/^[A-Za-z0-9][A-Za-z0-9&-]{0,24}(?:\.NS)?$/.test(q)) {
      try {
        companies = [
          {
            close: null,
            change: null,
            relative_volume: null,
            date: null,
            events: 0,
            ...(await resolveCompany(q)),
          },
        ];
      } catch {
        /* Try the public name directory; never guess a symbol. */
      }
    }
    if (!companies.length) {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
          { signal: AbortSignal.timeout(10000), redirect: "manual" },
        );
        if (!r.ok) throw new Error("Directory unavailable");
        const data = (await r.json()) as {
          quotes?: {
            symbol: string;
            longname?: string;
            shortname?: string;
            exchange?: string;
            quoteType?: string;
          }[];
        };
        for (const c of data.quotes ?? []) {
          if (
            !/^[A-Z0-9][A-Z0-9&-]{0,24}\.NS$/.test(c.symbol) ||
            c.exchange !== "NSI" ||
            c.quoteType !== "EQUITY"
          )
            continue;
          const name = c.longname ?? c.shortname;
          if (!name) continue;
          await run(
            "INSERT INTO companies(ticker,name,sector,validation,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(ticker) DO NOTHING",
            c.symbol,
            name,
            "Not classified",
            "Yahoo Finance symbol directory",
            new Date().toISOString(),
          );
          companies.push({
            ticker: c.symbol,
            name,
            sector: "Not classified",
            validation: "Yahoo Finance symbol directory",
            close: null,
            change: null,
            relative_volume: null,
            date: null,
            events: 0,
          });
        }
      } catch {
        limitation =
          "Company-name directory unavailable. Try a known NSE ticker; no symbol was guessed.";
      }
    }
  }
  if (!companies.length && q) {
    try {
      const cache = await one<{ payload: string }>(
        "SELECT payload FROM analysis_cache WHERE key='nse-equity-directory' AND expires_at>?",
        new Date().toISOString(),
      );
      const csv: string = cache
        ? JSON.parse(cache.payload)
        : await fetchPublicDirectory(
            "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          );
      if (!/^SYMBOL,\s*NAME OF COMPANY,/i.test(csv))
        throw new Error("Unsupported official directory");
      if (!cache)
        await run(
          "INSERT INTO analysis_cache(key,payload,created_at,expires_at,kind) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at",
          "nse-equity-directory",
          JSON.stringify(csv),
          new Date().toISOString(),
          new Date(Date.now() + 86400000).toISOString(),
          "company_directory",
        );
      for (const c of parseNseDirectory(csv, q)) {
        await run(
          "INSERT INTO companies(ticker,name,sector,validation,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(ticker) DO NOTHING",
          c.ticker,
          c.name,
          "Not classified",
          "NSE equity security directory",
          new Date().toISOString(),
        );
        companies.push({
          ...c,
          sector: "Not classified",
          validation: "NSE equity security directory",
          close: null,
          change: null,
          relative_volume: null,
          date: null,
          events: 0,
        });
      }
      limitation = companies.length
        ? undefined
        : "No matching NSE equity company found. Try a more specific name or verified ticker.";
    } catch {
      limitation =
        "Public company directories are unavailable. Try a known NSE ticker; no symbol was guessed.";
    }
  }
  const metadata = await all<{
    ticker: string;
    in_portfolio: number;
    indexed_documents: number;
  }>(
    "SELECT c.ticker,EXISTS(SELECT 1 FROM portfolio_companies p WHERE p.ticker=c.ticker AND p.owner=?) in_portfolio,(SELECT count(*) FROM documents d WHERE d.ticker=c.ticker) indexed_documents FROM companies c",
    owner,
  );
  const byTicker = new Map(metadata.map((m) => [m.ticker, m]));
  return {
    companies: companies.map((c) => ({
      ...c,
      ...byTicker.get(c.ticker),
      exchange: c.ticker.endsWith(".NS") ? "NSE" : "BSE",
    })),
    limitation,
  };
}
