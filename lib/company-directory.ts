export function parseNseDirectory(csv: string, query: string) {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/\blimited\b|\bltd\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  const q = clean(query);
  if (!q) return [];
  return csv
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const cells = (line.match(/(?:"(?:[^"]|"")*"|[^,]+)(?:,|$)/g) ?? []).map(
        (s) =>
          s
            .replace(/,$/, "")
            .replace(/^"|"$/g, "")
            .replaceAll('""', '"')
            .trim(),
      );
      const [symbol, name, series] = cells;
      if (
        series !== "EQ" ||
        !/^[A-Z0-9][A-Z0-9&-]{0,24}$/.test(symbol ?? "") ||
        !name
      )
        return [];
      return clean(name).includes(q) || clean(symbol).includes(q)
        ? [{ ticker: `${symbol}.NS`, name }]
        : [];
    })
    .sort(
      (a, b) =>
        Number(clean(b.name) === q) - Number(clean(a.name) === q) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 12);
}
