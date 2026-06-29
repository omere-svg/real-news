/**
 * Shared scoring math (ADR-0037 tidy). Pure, deterministic helpers used by both
 * `compute-base-score` and `signal-context`, so the log-normalization curve and
 * the clamp live in one place.
 */

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export const clamp01 = (value: number): number => clamp(value, 0, 1);

/**
 * Log-normalize a raw count to ~[0, 1]: diminishing returns as it approaches
 * `ref`, so 10k vs 11k barely moves while 0 vs 100 moves a lot.
 */
export function normalize(value: number, ref: number): number {
  return clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(ref));
}
