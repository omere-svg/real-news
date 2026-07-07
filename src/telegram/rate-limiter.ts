/**
 * Burst rate limiting (ADR-0022). A small seam so the bot's limiting is
 * unit-testable with an explicit clock. `now` is passed in (ms epoch) rather
 * than read, keeping implementations pure and deterministic.
 */
export interface RateLimiter {
  /** Record an event for `key` at `now`; return whether it is within budget. */
  allow(key: string, now: number): boolean;
}

/**
 * Fixed-window limiter: at most `capacity` events per `windowMs` per key. Simple,
 * maps directly to "N per minute", and trivially testable.
 *
 * Under open access any stranger's chat id mints a window entry, so the map is
 * swept of fully-expired windows on write (ADR-0050): a key whose window closed
 * carries no state worth keeping. This bounds memory over long uptime without a
 * background timer. The sweep is amortized (only when the map grows past a floor).
 */
export class FixedWindowLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  /** Don't bother sweeping below this many keys — the cost isn't worth it. */
  private static readonly SWEEP_FLOOR = 256;

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (this.windows.size >= FixedWindowLimiter.SWEEP_FLOOR) this.sweep(now);
      this.windows.set(key, { start: now, count: 1 });
      return this.capacity >= 1;
    }
    w.count += 1;
    return w.count <= this.capacity;
  }

  /** Drop windows that have fully expired — they'd reset on next use anyway. */
  private sweep(now: number): void {
    for (const [k, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(k);
    }
  }
}
