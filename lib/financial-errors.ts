export type FinancialErrorCode =
  | "source_unavailable"
  | "download_failed"
  | "unsupported_file_format"
  | "pdf_parsing_failed"
  | "reporting_period_unresolved"
  | "unit_ambiguous"
  | "metric_extraction_rejected"
  | "gemini_unavailable"
  | "gemini_rate_limit"
  | "source_verification_failed"
  | "database_persistence_failed";
export function financialError(
  error: unknown,
  stage = "download",
): { code: FinancialErrorCode; message: string } {
  const e = error as { message?: string; code?: string },
    raw = e?.message ?? String(error);
  const known: FinancialErrorCode[] = [
    "source_unavailable",
    "download_failed",
    "unsupported_file_format",
    "pdf_parsing_failed",
    "reporting_period_unresolved",
    "unit_ambiguous",
    "metric_extraction_rejected",
    "gemini_unavailable",
    "gemini_rate_limit",
    "source_verification_failed",
    "database_persistence_failed",
  ];
  let code: FinancialErrorCode =
    known.find((c) => raw.startsWith(c + ":")) ??
    (known.includes(e?.code as FinancialErrorCode)
      ? (e.code as FinancialErrorCode)
      : stage === "extraction"
        ? "metric_extraction_rejected"
        : "download_failed");
  if (/D1_ERROR|SQLITE_|FOREIGN KEY|constraint failed|database/i.test(raw))
    code = "database_persistence_failed";
  else if (
    (stage === "extraction" || /gemini/i.test(raw)) &&
    /429|rate.?limit|quota/i.test(raw)
  )
    code = "gemini_rate_limit";
  else if (
    /matching company|different company|source.*not.allowed|redirect.*reject|company.*unverified/i.test(
      raw,
    )
  )
    code = "source_verification_failed";
  else if (/valid PDF|unsupported.*format|not.*PDF|scanned|OCR/i.test(raw))
    code = "unsupported_file_format";
  else if (/HTTP (403|404|410|429|502|503)/.test(raw))
    code = "source_unavailable";
  else if (/PDF|font|parser/i.test(raw) && stage !== "download")
    code = "pdf_parsing_failed";
  else if (
    /gemini|model/i.test(raw) &&
    /unavailable|timeout|aborted|disabled/i.test(raw)
  )
    code = "gemini_unavailable";
  const message = raw
    .replace(/AIza[\w-]+/g, "[redacted]")
    .replace(/([?&](?:key|token|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .split(/\n\s*at /)[0]
    .slice(0, 500);
  return { code, message };
}
