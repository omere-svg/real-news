import type { SourceId } from '../domain/types.js';

export interface BackoffOptions {
  /** Consecutive failing ticks before a source is backed off. */
  readonly threshold: number;
  /** How many subsequent ticks to skip a backed-off source before retrying it. */
  readonly cooldownTicks: number;
}

/**
 * Closes the observe→act loop (ADR-0052). The tick pipeline already OBSERVES
 * per-source outcomes (`skipped`/`failed`) and REFLECTS on them (the advisory);
 * this makes it ADAPT: a Source that fails `threshold` ticks in a row is skipped
 * for the next `cooldownTicks` ticks — avoiding wasted, often rate-limited
 * fetch+LLM work (e.g. GDELT's recurring 429) — then automatically retried, and
 * a single success clears its streak. Pure and deterministic: the loop calls
 * `record()` after each tick and `activeBackoffs()` before the next.
 */
export class AdaptiveBackoff {
  private readonly consecutive = new Map<SourceId, number>();
  /** tick index up to (and including) which a source stays skipped. */
  private readonly until = new Map<SourceId, number>();

  constructor(private readonly opts: BackoffOptions) {}

  /** Source ids to skip at `tick` because they are still cooling down. */
  activeBackoffs(tick: number): Set<SourceId> {
    const active = new Set<SourceId>();
    for (const [id, until] of this.until) if (tick <= until) active.add(id);
    return active;
  }

  /**
   * Record a tick's outcome and return any sources newly placed into backoff.
   * `attempted` is the set of sources actually run this tick (not already backed
   * off); `failedOrSkipped` is those that didn't deliver. Every attempted source
   * NOT in `failedOrSkipped` succeeded, so its streak resets.
   */
  record(
    tick: number,
    attempted: readonly SourceId[],
    failedOrSkipped: readonly SourceId[],
  ): SourceId[] {
    const bad = new Set(failedOrSkipped);
    const newlyBackedOff: SourceId[] = [];
    for (const id of attempted) {
      if (!bad.has(id)) {
        this.consecutive.delete(id);
        this.until.delete(id);
        continue;
      }
      const n = (this.consecutive.get(id) ?? 0) + 1;
      if (n >= this.opts.threshold) {
        this.until.set(id, tick + this.opts.cooldownTicks);
        this.consecutive.delete(id);
        newlyBackedOff.push(id);
      } else {
        this.consecutive.set(id, n);
      }
    }
    return newlyBackedOff;
  }
}
