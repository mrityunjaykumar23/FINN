import financialSources from "../../data/financial-sources.json" with { type: "json" };
import { parseDocument, DomUtils } from "htmlparser2";
import { fiscalPeriod } from "../periods.ts";
export const DISCOVERY_VERSION = "primary_sources_v4";
export type Candidate = {
  url: string;
  title: string;
  type: string;
  published_at: string | null;
  period: string | null;
  officialHost?: string;
  size_bytes?: number | null;
  order: number;
  extraction_status?: string;
  indexed_pages?: number | null;
  total_pages?: number | null;
};
export const scheduledCallNotice = (text: string) =>
  /\b(?:intimation|schedule|invitation|invite|notice)\b.{0,140}\b(?:conference|concall|investor|analyst|earnings|board[ -]meeting)|\b(?:conference|concall|investor|analyst|earnings|board[ -]meeting)\b.{0,140}\b(?:intimation|schedule|invitation|invite|notice)\b/i.test(
    text.replace(/\s+/g, " "),
  );
export const disclosureNotice = (text: string) =>
  scheduledCallNotice(text) ||
  /newspaper[ -]publication|(?:audio|video)[ -]recording/i.test(text);
export const documentType = (text: string) =>
  /voting.results|scrutiniz|postal.ballot|outcomeofpb/i.test(text)
    ? "announcement"
    : /transcript/i.test(text)
      ? "transcript"
      : disclosureNotice(text)
        ? "announcement"
        : /concall|earnings.call/i.test(text)
          ? "transcript"
          : /annual.report|annual\s+report/i.test(text)
            ? "annual_report"
            : /presentation/i.test(text)
              ? "presentation"
              : /result|financial.statement|integrated.filing.indas|ixbrl|xbrl/i.test(
                    text,
                  ) ||
                  (/press.release/i.test(text) &&
                    /Q[1-4]\s*FY\s*\d{2,4}|quarter.{0,30}ended/i.test(text))
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
    /href=["'](https?:\/\/[^"']+)["'][^>]*>\s*(?:[\s\S]{0,150}?)?(?:Website|Company website)/i,
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
    if (!financialSourceUrl(url) || !allowed(url, officialHost) || !title)
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
        .match(/(?:Q[1-4]\s*)?FY\s*\d{4}/i)?.[0]
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
export function financialSourceUrl(url: string) {
  return /\.pdf(?:[?#]|$)|\.(?:xbrl|xml)(?:[?#]|$)|\/corporate\/ixbrl\/[^?#]+\.html?(?:[?#]|$)/i.test(
    url,
  );
}
function candidatePeriod(title: string) {
  title = title.replace(/_/g, " ");
  const q = title.match(/Q([1-4])\s*FY\s*['’]?(\d{2,4})/i);
  if (q) return `Q${q[1]} FY${Number(q[2]) < 100 ? 2000 + Number(q[2]) : q[2]}`;
  const range = title.match(/(?:FY\s*)?(20\d{2})[–-](\d{2}|20\d{2})(?!\d)/i);
  if (range)
    return `FY${range[2].length === 2 ? Number(range[1].slice(0, 2) + range[2]) : range[2]}`;
  const y = title.match(/FY\s*['’]?(\d{4})/i);
  return y ? `FY${y[1]}` : null;
}
export function officialFinancialLinks(
  html: string,
  base: string,
  host: string,
  allowed: (url: string, host?: string) => boolean,
) {
  const dom = parseDocument(html);
  for (const node of DomUtils.findAll(
    (e) => ["script", "style", "noscript"].includes(e.name),
    dom.children,
  ))
    DomUtils.removeElement(node);
  const anchors = DomUtils.findAll(
    (e) => e.name === "a" && !!e.attribs.href,
    dom.children,
  );
  const candidates: Candidate[] = [],
    pages: { url: string; score: number }[] = [];
  for (const a of anchors) {
    let url: string;
    try {
      url = new URL(a.attribs.href, base).href;
      if (url.startsWith("http://")) url = url.replace(/^http:/, "https:");
    } catch {
      continue;
    }
    if (!allowed(url, host)) continue;
    const title =
      DomUtils.textContent(a).replace(/\s+/g, " ").trim() ||
      decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
    if (financialSourceUrl(url)) {
      const caption = title + " " + decodeURIComponent(new URL(url).pathname);
      candidates.push({
        url,
        title: title.slice(0, 240),
        type: documentType(caption),
        published_at: null,
        period: candidatePeriod(caption),
        officialHost: host,
        order: candidates.length,
      });
    } else if (
      new URL(url).hostname.replace(/^www\./, "") === host &&
      !/\.(?:mp3|mp4|zip|jpg|png|svg)(?:[?#]|$)/i.test(url)
    ) {
      const s = title + " " + url;
      if (
        /investor|financial|quarter|annual|results|transcript|earnings/i.test(
          s,
        ) &&
        !/[?&]year=20(?:0\d|1\d|2[0-5])/i.test(url)
      )
        pages.push({
          url,
          score: /quarter|result/i.test(s)
            ? 100
            : /financial/i.test(s)
              ? 80
              : /annual|transcript/i.test(s)
                ? 70
                : 50,
        });
    }
  }
  return {
    candidates,
    pages: [...new Map(pages.map((p) => [p.url, p])).values()].sort(
      (a, b) => b.score - a.score,
    ),
  };
}
async function discoverOfficial(
  host: string,
  allowed: (url: string, host?: string) => boolean,
  signal: AbortSignal,
) {
  const root = `https://www.${host}/`,
    seen = new Set<string>([root]),
    found: Candidate[] = [];
  let frontier = [{ url: root, score: 100 }];
  // Two bounded link levels reach common investor/results paths without guessing company URLs.
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const batch = frontier.slice(0, depth === 0 ? 1 : 2);
    frontier = [];
    const results = await Promise.allSettled(
      batch.map(async (p) =>
        officialFinancialLinks(
          await fetchPublicDirectory(p.url, signal),
          p.url,
          host,
          allowed,
        ),
      ),
    );
    for (const r of results)
      if (r.status === "fulfilled") {
        found.push(...r.value.candidates);
        for (const p of r.value.pages)
          if (!seen.has(p.url)) {
            seen.add(p.url);
            frontier.push(p);
          }
      }
    frontier.sort((a, b) => b.score - a.score);
  }
  return [...new Map(found.map((c) => [c.url, c])).values()];
}
export function rankCandidates(
  candidates: Candidate[],
  question = "",
  filters: { type?: string; period?: string } = {},
) {
  const preferred =
    filters.type ??
    (/guidance|management|expansion|outlook/i.test(question)
      ? "transcript"
      : /balance.sheet|cash|debt|annual|risk/i.test(question)
        ? "annual_report"
        : "results");
  const requested =
    filters.period ??
    question
      .match(/(?:Q[1-4]\s+)?FY\s*\d{4}/i)?.[0]
      .replace(/FY\s+/i, "FY")
      .toUpperCase();
  const tokens = (question.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
    (t) =>
      !["what", "with", "from", "that", "this", "company", "report"].includes(
        t,
      ),
  );
  const score = (c: Candidate) =>
    (c.type === preferred
      ? 80
      : c.type === "annual_report"
        ? 35
        : c.type === "transcript"
          ? 25
          : c.type === "presentation"
            ? 15
            : 0) +
    (requested ? (c.period === requested ? 160 : c.period ? -100 : 0) : 0) +
    tokens.filter((t) => c.title.toLowerCase().includes(t)).length * 8 +
    (/financial.results|financial.statements|unaudited|audited|integrated.filing.indas/i.test(
      c.title,
    ) && !/press.release/i.test(c.title)
      ? 18
      : 0) +
    (c.published_at ? 15 : 0) +
    (c.extraction_status === "complete" ? 25 : 0) +
    (c.total_pages && c.indexed_pages
      ? (20 * c.indexed_pages) / c.total_pages
      : 0) +
    (!requested && c.period
      ? Math.max(
          0,
          Math.min(
            20,
            (Number(c.period.match(/FY(\d{4})/)?.[1] ?? 0) - 2020) * 2,
          ),
        )
      : 0);
  return [...candidates].sort((a, b) => {
    const affinity = (c: Candidate) =>
      c.type === preferred
        ? 0
        : c.type === "results"
          ? 1
          : c.type === "presentation"
            ? 2
            : c.type === "annual_report"
              ? 3
              : c.type === "transcript"
                ? 4
                : 5;
    if (!requested) {
      const type = affinity(a) - affinity(b);
      if (type) return type;
      const ap = fiscalPeriod(a.period ?? ""),
        bp = fiscalPeriod(b.period ?? "");
      if (!!ap !== !!bp) return ap ? -1 : 1;
      if (ap && bp && ap.ordinal !== bp.ordinal) return bp.ordinal - ap.ordinal;
    }
    return (
      score(b) - score(a) ||
      (fiscalPeriod(b.period ?? "")?.ordinal ?? 0) -
        (fiscalPeriod(a.period ?? "")?.ordinal ?? 0) ||
      (b.published_at ?? "").localeCompare(a.published_at ?? "") ||
      a.order - b.order
    );
  });
}
export async function locatePrimaryCandidates(
  ticker: string,
  allowed: (url: string, host?: string) => boolean,
  signal: AbortSignal = AbortSignal.timeout(20000),
) {
  const registered = financialSources.find((s) => s.ticker === ticker);
  if (registered) {
    try {
      const html = await fetchPublicDirectory(registered.url, signal);
      const urls = [
        ...new Set(
          [...html.matchAll(/https[^\s"<>]+\.pdf(?:\?[^"<>\s]*)?/gi)].map((m) =>
            decode(m[0]),
          ),
        ),
      ];
      const candidates = urls
        .filter((u) => allowed(u, registered.officialHost))
        .map((url, order) => ({
          url,
          title: decodeURIComponent(new URL(url).pathname.split("/").at(-1)!)
            .replace(/\.pdf$/i, "")
            .replace(/[_-]/g, " "),
          type: documentType(decodeURIComponent(url)),
          published_at: null,
          period: null,
          officialHost: registered.officialHost,
          order,
        }));
      if (candidates.length)
        return { candidates, officialHost: registered.officialHost };
    } catch {
      /* A failed registered page can still use permitted directory originals. */
    }
  }
  const url = `https://www.screener.in/company/${encodeURIComponent(ticker.replace(/\.(NS|BO)$/, ""))}/consolidated/`;
  const html = await fetchPublicDirectory(url, signal),
    parsed = parseCandidates(html, allowed);
  // Follow only the directory's own, narrowly scoped Raw-PDF redirect endpoints.
  // The redirect target must be an independently permitted original PDF; directory
  // financial tables and figures are never imported as evidence.
  const raw = [
    ...new Set(
      [
        ...html.matchAll(
          /href=["'](\/company\/source\/quarter\/\d+\/\d{1,2}\/\d{4}\/)["']/g,
        ),
      ].map((m) => m[1]),
    ),
  ]
    .sort((a, b) => {
      const date = (s: string) => {
        const p = s.split("/");
        return Number(p.at(-2)) * 100 + Number(p.at(-3));
      };
      return date(b) - date(a);
    })
    .slice(0, 3);
  const originals = await Promise.allSettled(
    raw.map(async (path, order) => {
      const r = await fetch("https://www.screener.in" + path, {
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      const target = r.headers.get("location");
      await r.body?.cancel();
      if (![301, 302, 303, 307, 308].includes(r.status) || !target) return null;
      const original = new URL(target, "https://www.screener.in").href;
      if (
        !financialSourceUrl(original) ||
        !allowed(original, parsed.officialHost)
      )
        return null;
      return {
        url: original,
        title: "Original quarterly financial results",
        type: "results",
        published_at: null,
        period: null,
        officialHost: parsed.officialHost,
        order: order - 3,
      };
    }),
  );
  const first = originals.flatMap((r) =>
    r.status === "fulfilled" && r.value ? [r.value] : [],
  );
  const official = parsed.officialHost
    ? await discoverOfficial(parsed.officialHost, allowed, signal).catch(() => [])
    : [];
  return {
    ...parsed,
    candidates: [
      ...official,
      ...first.filter((c) => !official.some((p) => p.url === c.url)),
      ...parsed.candidates.filter(
        (c) => ![...first, ...official].some((p) => p.url === c.url),
      ),
    ],
  };
}
export async function fetchPublicDirectory(url: string, signal?: AbortSignal) {
  let target = url,
    r: Response | undefined;
  const host = new URL(url).hostname.replace(/^www\./, ""),
    deadline = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000);
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
