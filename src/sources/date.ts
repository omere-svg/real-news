/**
 * Parse an upstream date string to epoch ms, or null. `Date.parse` returns NaN
 * (not null) for a truthy-but-unparseable value like `''` or `'unknown'`, and
 * libsql rejects a NaN bind ("Only finite numbers … can be passed as arguments")
 * — one malformed upstream date would otherwise fail the whole tick's persist
 * stage. Every JSON source adapter routes its date through here (ADR-0049).
 */
export function parseDateOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** YYYY-MM-DD for an epoch-ms instant, in UTC (for date-bounded API queries). */
export function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
