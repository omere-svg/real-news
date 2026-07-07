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
/** The per-tick outcome shape `seed` replays — a subset of a stored TickReport. */
export interface BackoffHistoryTick {
  readonly skipped: readonly SourceId[];
  readonly failed: readonly { readonly source: SourceId }[];
}

export class AdaptiveBackoff {
  private readonly consecutive = new Map<SourceId, number>();
  /** tick index up to (and including) which a source stays skipped. */
  private readonly until = new Map<SourceId, number>();

  constructor(private readonly opts: BackoffOptions) {}

  /**
   * Rehydrate streaks from persisted tick reports (ADR-0053), oldest first, so
   * a restart/deploy doesn't amnesia the adapt loop. Backed-off sources are
   * absent from a stored report (they were never attempted), so replaying
   * `skipped ∪ failed` against the full source list is conservative: a source
   * mid-cooldown at shutdown resumes with a clean streak at worst. Returns the
   * tick index the live loop should continue from.
   */
  seed(history: readonly BackoffHistoryTick[], sources: readonly SourceId[]): number {
    history.forEach((t, i) => {
      this.record(i, sources, [...t.skipped, ...t.failed.map((f) => f.source)]);
    });
    return history.length;
  }

  /**
   * Impose a backoff directly (ADR-0053) — the reflection→action path, where a
   * screened LLM proposal rests a source without waiting for the 3-strikes
   * counter. Same cooldown bookkeeping as an earned backoff.
   */
  force(source: SourceId, fromTick: number, ticks: number): void {
    this.until.set(source, fromTick + ticks - 1);
    this.consecutive.delete(source);
  }

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
