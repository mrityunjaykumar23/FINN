export function sourceHref(url: string, page?: number, format?: string) {
  const structured =
    (format && format !== "pdf") || /\.(?:html?|xml|xbrl)(?:[?#]|$)/i.test(url);
  return page && !structured ? `${url.split("#")[0]}#page=${page}` : url;
}
export function sourceLocation(
  page: number,
  format?: string,
  location?: string | null,
) {
  return format && format !== "pdf"
    ? (location ?? `Structured section ${page}`)
    : `PDF p.${page}`;
}
