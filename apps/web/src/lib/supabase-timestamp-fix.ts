// Supabase's REST API (PostgREST) returns `timestamp without time zone`
// columns — which is every DateTime column in this schema (every table was
// checked: Lead, Tenant, Payment, Complaint, MaintenanceRequest, etc. all use
// this type) — as naive strings with no timezone designator, e.g.
// "2026-08-02T00:29:51.321". `new Date(...)` on a string like that is parsed
// as LOCAL time per the ECMAScript date-time string spec, not UTC, silently
// shifting every timestamp read this way by the browser's UTC offset (3h in
// Brazil) and, near midnight, onto the wrong calendar day. Every column
// really does hold UTC (confirmed against the DB's own `now()` during
// investigation), so appending `Z` here is correct, not a guess.
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function addUtcSuffixDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return (NAIVE_TIMESTAMP.test(value) ? `${value}Z` : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => addUtcSuffixDeep(v)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, addUtcSuffixDeep(v)]),
    ) as T;
  }
  return value;
}
