/** Stable filter order keeps legacy and durable research requests on one cache identity. */
export function canonicalResearchFilters(filters: {
  period?: string;
  type?: string;
}) {
  return {
    ...(filters.period ? { period: filters.period } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };
}
