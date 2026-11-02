/** Display reported financial decimals without rounding them to whole crores. */
export const financialNumber = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Unavailable"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 20 }).format(
        value,
      );

export function publicationLabel(input: {
  date: string;
  published_at?: string;
  publication_precision?: string;
}) {
  const precise =
    input.publication_precision === "company_recorded_datetime" &&
    !!input.published_at &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(input.published_at) &&
    Number.isFinite(Date.parse(input.published_at));
  const d = new Date(
    precise ? input.published_at! : input.date + "T12:00:00+05:30",
  );
  if (!Number.isFinite(+d)) return "Publication date unavailable";
  const day = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
  return precise
    ? `${day} · ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(d)} IST`
    : `${day} · date only`;
}

export function guidanceTone(status: string, variance: number | null) {
  if (
    variance === null ||
    /insufficient|incompatible|awaiting|superseded/i.test(status)
  )
    return "neutral";
  return /below/i.test(status) || variance < 0 ? "critical" : "verified";
}

export function guidanceScale(low: number, high: number, actual: number) {
  const span = Math.max(
    Math.abs(high - low),
    Math.abs(actual - low),
    Math.abs(actual - high),
    0.1,
  );
  const min = Math.min(low, high, actual) - span * 0.2;
  const max = Math.max(low, high, actual) + span * 0.2;
  const position = (v: number) => ((v - min) / (max - min)) * 100;
  return {
    min,
    max,
    start: position(low),
    width: position(high) - position(low),
    actual: position(actual),
  };
}
