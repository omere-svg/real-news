/**
 * Clamp a requested attention budget to a safe range (ADR-0023). Guards the
 * budgeting/query layer against cost amplification: `NaN` and non-positive
 * values floor to a tiny budget, and anything above `max` (including Infinity)
 * is capped. Pure and exhaustively testable.
 */
export function normalizeMinutes(value: number, max: number): number {
  if (Number.isNaN(value) || value <= 0) return 1;
  return Math.min(value, max);
}
