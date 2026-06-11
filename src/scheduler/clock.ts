/**
 * The Clock seam. Recency decay (ADR-0008) and the tick scheduler (ADR-0001)
 * both read time through this interface so tests are deterministic — no
 * dependence on Date.now() in the units under test.
 */
export interface Clock {
  /** Current time in Unix epoch milliseconds. */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
