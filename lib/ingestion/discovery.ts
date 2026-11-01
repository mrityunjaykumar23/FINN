export type Candidate = {
  url: string;
  title: string;
  type: string;
  published_at: string | null;
  period: string | null;
  officialHost?: string;
  size_bytes?: number | null;
  order: number;
};
export const documentType = (text: string) =>
  /transcript|concall|earnings.call/i.test(text)
    ? "transcript"
    : /annual.report|annual\s+report/i.test(text)
      ? "annual_report"
      : /presentation/i.test(text)
        ? "presentation"
        : /result|financial.statement/i.test(text)
          ? "results"
          : "announcement";
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
const plain = (s: string) =>
  decode(
    s
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
export function parseCandidates(
  html: string,
  allowed: (url: string, host?: string) => boolean,
) {
  const website = html.match(
    /href=["'](https:\/\/[^"']+)["'][^>]*>\s*(?:[\s\S]{0,150}?)?(?:Website|Company website)/i,
  );
  let officialHost: string | undefined;
  try {
    officialHost = website
      ? new URL(website[1]).hostname.replace(/^www\./, "")
      : undefined;
  } catch {}
  const candidates: Candidate[] = [];
  for (const m of html.matchAll(
    /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    const url = decode(m[2]),
      title = plain(m[4]);
    if (!/\.pdf(?:\?|$)/i.test(url) || !allowed(url, officialHost) || !title)
      continue;
    if (candidates.some((c) => c.url === url)) continue;
    // Only an explicit date attached to this link is a publication date. URL dates,
    // relative directory timestamps and neighbouring disclosures are not authoritative.
    const rawDate = (m[1] + m[3]).match(
      /data-(?:published|date)=["'](\d{4}-\d{2}-\d{2})["']/,
    )?.[1];
    const published_at =
      rawDate && !Number.isNaN(Date.parse(rawDate)) ? rawDate : null;
    const period =
      title
        .match(/(?:Q[1-4]\s+)?FY\s*\d{4}/i)?.[0]
        ?.replace(/FY\s+/i, "FY")
        .toUpperCase() ?? null;
    candidates.push({
      url,
      title,
      type: documentType(title),
      published_at,
      period,
      officialHost,
      order: candidates.length,
    });
    if (candidates.length >= 80) break;
  }
  return { candidates, officialHost };
}
export function rankCandidates(
  candidates: Candidate[],
  question = "",
  filters: { type?: string; period?: string } = {},
) {
  const preferred =
    filters.type ??
    (/guidance|management|expansion|outlook|risk/i.test(question)
      ? "transcript"
      : /balance.sheet|cash|debt|annual/i.test(question)
        ? "annual_report"
        : "results");
  const score = (c: Candidate) =>
    (c.type === preferred ? 100 : 0) +
    (filters.period && c.period === filters.period ? 80 : 0) +
    (c.published_at ? 20 : 0) +
    (c.type === "presentation" ? 5 : 0);
  return [...candidates].sort(
    (a, b) =>
      score(b) - score(a) ||
      (b.published_at ?? "").localeCompare(a.published_at ?? "") ||
      a.order - b.order,
  );
}
export async function locatePrimaryCandidates(
  ticker: string,
  allowed: (url: string, host?: string) => boolean,
) {
  const url = `https://www.screener.in/company/${encodeURIComponent(ticker.replace(/\.(NS|BO)$/, ""))}/consolidated/`;
  return parseCandidates(await fetchPublicDirectory(url), allowed);
}
export async function fetchPublicDirectory(url: string) {
  let target = url,
    r: Response | undefined;
  const host = new URL(url).hostname.replace(/^www\./, ""),
    deadline = AbortSignal.timeout(12000);
  for (let hop = 0; hop < 3; hop++) {
    r = await fetch(target, {
      redirect: "manual",
      signal: deadline,
      headers: {
        "User-Agent": "FINN/1.0 public primary-document link discovery",
      },
    });
    if (![301, 302, 303, 307, 308].includes(r.status)) break;
    const next = new URL(r.headers.get("location") ?? "", target);
    await r.body?.cancel();
    if (
      next.protocol !== "https:" ||
      next.username ||
      next.password ||
      next.port ||
      next.hostname.replace(/^www\./, "") !== host
    )
      throw new Error(
        `Directory redirect rejected (${next.protocol === "https:" ? "host change" : "insecure protocol"}); original-file import remains available.`,
      );
    target = next.href;
  }
  if (!r) throw new Error("Directory unavailable");
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(
      `Directory returned HTTP ${r.status}; protected original-filing import is available.`,
    );
  }
  const reader = r.body?.getReader();
  if (!reader) throw new Error("Empty source directory");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const v = await reader.read();
    if (v.done) break;
    size += v.value.length;
    if (size > 2000000) {
      await reader.cancel();
      throw new Error("Directory exceeded bounded retrieval size");
    }
    parts.push(v.value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(joined);
}
export function parseOfficialTable(
  html: string,
  baseUrl: string,
  officialHost: string,
  allowed: (url: string, host?: string) => boolean,
) {
  const candidates: Candidate[] = [];
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => m[1],
    );
    if (cells.length < 3) continue;
    const date = plain(cells[0]).match(
      /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/,
    );
    const link = cells
      .slice(2)
      .join(" ")
      .match(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i);
    if (!date || !link) continue;
    const month = months.indexOf(date[1].toLowerCase());
    if (month < 0) continue;
    const published_at = `${date[3]}-${String(month + 1).padStart(2, "0")}-${date[2].padStart(2, "0")}`,
      url = new URL(decode(link[1]), baseUrl).href,
      title = plain(cells[1]);
    if (
      !allowed(url, officialHost) ||
      !title ||
      candidates.some((c) => c.url === url)
    )
      continue;
    candidates.push({
      url,
      title,
      type: documentType(title),
      published_at,
      period: null,
      officialHost,
      order: candidates.length,
    });
    if (candidates.length >= 80) break;
  }
  return { candidates, officialHost };
}
