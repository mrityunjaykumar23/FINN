export type ExtractionResult = {
  status: string;
  metrics?: number;
  guidance?: number;
  error_code?: string;
};
export function extractionOutcome(
  result: ExtractionResult,
  type: string,
  attempt = 1,
) {
  if (/failed|error|rejected/.test(result.status))
    return {
      status: attempt >= 3 ? "manual_required" : "extraction_failed",
      error: result.error_code ?? result.status,
    };
  if (
    ["results", "annual_report", "presentation", "transcript"].includes(type) &&
    !(Number(result.metrics) > 0 || Number(result.guidance) > 0)
  )
    return {
      status: "manual_required",
      error:
        "No verified financial values or quantified guidance accepted; indexed text remains available.",
    };
  return { status: "complete", error: null };
}
export async function processIndependentCandidates<T>(
  items: T[],
  process: (item: T) => Promise<unknown>,
  failure: (item: T, error: unknown) => Promise<unknown>,
) {
  for (const item of items) {
    try {
      await process(item);
    } catch (error) {
      await failure(item, error);
    }
  }
}
export function publicationMetadata(input: {
  date: string;
  publication_precision?: string;
  publication_timezone?: string;
  published_at?: string;
  source_timestamp?: string;
  date_precision?: string;
}) {
  const stamp = input.source_timestamp ?? input.published_at;
  const precise =
    input.publication_precision === "company_recorded_datetime" &&
    !!stamp &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(stamp) &&
    Number.isFinite(Date.parse(stamp));
  return {
    publication_precision: precise ? "company_recorded_datetime" : "date",
    publication_timezone: precise
      ? (input.publication_timezone ?? stamp!.match(/(?:Z|[+-]\d\d:\d\d)$/)![0])
      : (input.publication_timezone ?? undefined),
    published_at: precise ? stamp! : input.date,
    date_precision: precise
      ? "Company-recorded publication timestamp; exchange broadcast time not verified"
      : "Publication date only; source publication time not verified",
  };
}
