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
 * maps directly to "N per minute", and trivially testable. State grows with the
 * number of distinct keys (bounded by real chats); pruning is a later concern.
 */
export class FixedWindowLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return this.capacity >= 1;
    }
    w.count += 1;
    return w.count <= this.capacity;
  }
}
