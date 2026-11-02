import {
  documentType,
  fetchPublicDirectory,
  locatePrimaryCandidates,
} from "./discovery.ts";
export type SourceConfig = {
  ticker: string;
  provider: string;
  url: string;
  officialHost: string;
  layout?: string;
  scope_end?: string;
  note: string;
};
export type AnnouncementCandidate = {
  ticker: string;
  provider: string;
  external_id: string;
  title: string;
  url: string;
  type: string;
  published_at: string | null;
  source_timestamp?: string | null;
  publication_precision: "date" | "company_recorded_datetime" | "unknown";
  publication_timezone: string | null;
  verification_status: "official_page" | "candidate";
  discovered_at: string;
  officialHost?: string;
  period: string | null;
  order: number;
};
const plain = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(?:160|xA0);|&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
export function sourceDate(text: string): string | null {
  const s = plain(text).replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let y = 0,
    m = 0,
    d = 0;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/),
    numeric = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/),
    months = [
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
  if (iso) {
    [, y, m, d] = iso.map(Number);
  } else if (numeric) {
    d = +numeric[1];
    m = +numeric[2];
    y = +numeric[3];
  } else {
    const a = s.match(/^(\d{1,2})\s+([A-Za-z]+)[, ]+\s*(\d{4})$/),
      b = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (a) {
      d = +a[1];
      m = months.indexOf(a[2].slice(0, 3).toLowerCase()) + 1;
      y = +a[3];
    } else if (b) {
      d = +b[2];
      m = months.indexOf(b[1].slice(0, 3).toLowerCase()) + 1;
      y = +b[3];
    }
  }
  if (!y || !m || !d) return null;
  const result = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(result + "T12:00:00Z");
  return Number.isFinite(+check) && check.toISOString().slice(0, 10) === result
    ? result
    : null;
}
export function parseSource(
  config: SourceConfig,
  raw: string,
  allowed: (url: string, host?: string) => boolean,
): AnnouncementCandidate[] {
  const found: AnnouncementCandidate[] = [],
    now = new Date().toISOString();
  const add = (
    url: string,
    title: string,
    date: string | null,
    id?: string,
    precise = false,
  ) => {
    try {
      url = new URL(url.replace(/&amp;/g, "&"), config.url).href;
    } catch {
      return;
    }
    if (
      !allowed(url, config.officialHost) ||
      !title ||
      found.some((c) => c.url === url)
    )
      return;
    const day = date ? sourceDate(date) : null;
    found.push({
      ticker: config.ticker,
      provider: config.provider,
      external_id: id ?? url,
      title: plain(title),
      url,
      type: documentType(title),
      published_at: day,
      source_timestamp: precise ? date : null,
      publication_precision: day
        ? precise
          ? "company_recorded_datetime"
          : "date"
        : "unknown",
      publication_timezone: day ? "Asia/Kolkata" : null,
      verification_status: "official_page",
      discovered_at: now,
      officialHost: config.officialHost,
      period: null,
      order: found.length,
    });
  };
  if (config.layout === "maruti_cms") {
    const data = JSON.parse(raw),
      items = data?.data?.corporateDocumentsList?.items;
    if (!Array.isArray(items))
      throw new Error("Structured disclosure schema changed");
    for (const item of items) {
      const url =
        item.pdfLink?._publishUrl ??
        item.pdfLink?._path ??
        item.externalUrlLink;
      if (typeof url === "string" && typeof item.title === "string")
        add(
          url,
          item.title,
          typeof item.date === "string" ? item.date : null,
          item._path,
          !!item.date,
        );
    }
  } else if (config.layout === "dated_list") {
    for (const m of raw.matchAll(
      /<(?:article|li)\b[^>]*>([\s\S]*?)<\/(?:article|li)>/gi,
    )) {
      const link = m[1].match(
          /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
        ),
        time = m[1].match(/<time([^>]*)>([\s\S]*?)<\/time>/i);
      const date = time
        ? (time[1].match(/datetime=["']([^"']+)["']/i)?.[1] ?? plain(time[2]))
        : null;
      if (link) add(link[1], plain(link[2]), date);
    }
  } else {
    const rows = [...raw.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (!rows.length)
      throw new Error("Official disclosure table unavailable or changed");
    for (const row of rows) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
        (m) => m[1],
      );
      if (cells.length < 2) continue;
      const dateIndex = cells.findIndex((c) => sourceDate(plain(c)) !== null);
      const link = cells
        .join(" ")
        .match(
          /<a\b[^>]*href=["']([^"']*\.pdf(?:[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/i,
        );
      if (!link) continue;
      const title =
        config.layout === "ntpc_table"
          ? plain(cells[1])
          : plain(link[2])
              .replace(/\(\d+(?:\.\d+)?\s*(?:KB|MB)\)/gi, "")
              .trim();
      add(link[1], title, dateIndex < 0 ? null : plain(cells[dateIndex]));
    }
  }
  if (!found.length)
    throw new Error(
      "No usable original disclosure links; source schema/coverage requires review",
    );
  return found;
}
export async function discoverSource(
  config: SourceConfig | undefined,
  ticker: string,
  allowed: (url: string, host?: string) => boolean,
  cursor?: string | null,
) {
  let all: AnnouncementCandidate[];
  if (
    config?.scope_end &&
    new Date().toISOString().slice(0, 10) > config.scope_end
  )
    throw new Error(
      "Registered source period expired; configuration review required",
    );
  if (config)
    all = parseSource(config, await fetchPublicDirectory(config.url), allowed);
  else
    all = (await locatePrimaryCandidates(ticker, allowed)).candidates.map(
      (c) => ({
        ...c,
        ticker,
        provider: "announcements_directory",
        external_id: c.url,
        published_at: null,
        publication_precision: "unknown",
        publication_timezone: null,
        verification_status: "candidate",
        discovered_at: new Date().toISOString(),
      }),
    );
  const sorted = all.sort(
    (a, b) =>
      (b.published_at ?? "").localeCompare(a.published_at ?? "") ||
      b.url.localeCompare(a.url),
  );
  const key = (c: AnnouncementCandidate) =>
    `${c.published_at ?? "0000-00-00"}|${c.url}`;
  const head = sorted.slice(0, 80),
    tail = cursor ? sorted.filter((c) => key(c) < cursor).slice(0, 80) : [];
  const items = [
      ...new Map([...head, ...tail].map((c) => [c.url, c])).values(),
    ],
    last = (tail.length ? tail : head).at(-1);
  const remaining = last ? sorted.some((c) => key(c) < key(last)) : false;
  return {
    items,
    total: all.length,
    next_cursor: remaining && last ? key(last) : null,
    coverage: config
      ? config.note
      : "Undated link-directory candidates require verified administrative import.",
  };
}
