import type { SourceId } from '../domain/types.js';
import { lockSkipRecord, type TickRecord } from '../db/tick-report-repo.js';
import type { TickReport } from '../pipeline/tick-runner.js';
import type { Logger } from '../log/logger.js';
import type { Clock } from './clock.js';

/** The slice of TickRunner the loop drives. */
export interface TickLoopRunner {
  run(opts: {
    skipSources: ReadonlySet<SourceId>;
    deepAnalysisTopN?: number;
  }): Promise<TickReport>;
}

/** The slice of the advisory TickLock the loop needs (ADR-0047). */
export interface TickLoopLock {
  acquire(now: number, ttlMs: number): Promise<boolean>;
  release(): Promise<void>;
}

/** The slice of TickReportRepo the loop writes (ADR-0033). */
export interface TickRecorder {
  record(rec: TickRecord): Promise<void>;
}

/** The slice of AdaptiveBackoff the loop feeds (ADR-0052). */
export interface TickBackoff {
  activeBackoffs(tick: number): ReadonlySet<SourceId>;
  record(
    tick: number,
    attempted: readonly SourceId[],
    failedOrSkipped: readonly SourceId[],
  ): SourceId[];
}

/** The slice of AgentPolicyRepo the loop reads each tick (ADR-0053). */
export interface TickPolicyReader {
  get(): Promise<{ readonly deepAnalysisTopN: number | null } | null>;
}

export interface TickLoopDeps {
  readonly runner: TickLoopRunner;
  readonly lock: TickLoopLock;
  /** When false, ticks never touch the lock (single-writer deployments). */
  readonly lockEnabled: boolean;
  readonly lockTtlMs: number;
  readonly clock: Clock;
  readonly reports: TickRecorder;
  readonly backoff: TickBackoff;
  /** All source ids (Story AND Signal, ADR-0054) — the attempted set is derived
   * by subtracting backoffs, so a failing signal feed can rest too. */
  readonly sourceIds: readonly SourceId[];
  readonly policy: TickPolicyReader;
  /** Retention + reflection (ADR-0042). Runs after EVERY non-lock-skipped tick,
   * success or failure; its errors are contained. */
  readonly maintain: () => Promise<void>;
  /** Optional post-tick work on the success path (the per-tick summary backfill,
   * ADR-0038). The caller owns its error handling. */
  readonly afterTick?: () => Promise<void>;
  readonly log: Logger;
  /** The backoff clock's starting index — the value `AdaptiveBackoff.seed` returned. */
  readonly initialTickIndex?: number;
}

/**
 * The scheduler around TickRunner, extracted from the composition root so its
 * semantics are tested: the cross-process advisory lock (skips are RECORDED,
 * ADR-0048), the re-entrancy guard (a long tick is never overlapped), the
 * exclusive pipeline queue (boot backfill and ticks never contend, ADR-0047),
 * the adaptive-backoff feed (observe → adapt, ADR-0052), the per-tick policy
 * read (ADR-0053), and maintain-always-runs (a failing tick is still counted,
 * pruned, and reflected on, ADR-0042).
 */
export class TickLoop {
  /** Advances once per attempted (non-lock-skipped) tick — the backoff clock. */
  private index: number;
  /** Serializes the pipeline: boot backfill and every tick share one queue. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Re-entrancy guard: a tick can outlast the interval (ADR-0038). */
  private ticking = false;

  constructor(private readonly deps: TickLoopDeps) {
    this.index = deps.initialTickIndex ?? 0;
  }

  /** The current backoff tick index (the reflection→action path forces
   * cooldowns relative to it, ADR-0053). */
  tickIndex(): number {
    return this.index;
  }

  /**
   * Run `fn` serialized with the tick pipeline (ADR-0047) — used by the boot
   * backfill so it never overlaps a tick and contends for the model / the store.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.catch(() => undefined);
    return result;
  }

  /** First tick immediately, then every `intervalMs` (ADR-0001). */
  start(intervalMs: number): void {
    void this.runTick();
    setInterval(() => void this.runTick(), intervalMs);
  }

  /** One scheduled tick: skipped if the previous one is still running. */
  async runTick(): Promise<void> {
    if (this.ticking) {
      this.deps.log.warn('tick.overlap_skip', { reason: 'previous tick still running' });
      return;
    }
    this.ticking = true;
    try {
      await this.runExclusive(() => this.tickBody());
    } finally {
      this.ticking = false;
    }
  }

  /** Best-effort persist of a tick outcome (ADR-0033); a failed write never breaks the loop. */
  private recordTick(rec: TickRecord): void {
    void this.deps.reports
      .record(rec)
      .catch((err) => this.deps.log.error('tick.record_failed', { err }));
  }

  private async tickBody(): Promise<void> {
    const { deps } = this;
    let acquired: boolean;
    try {
      // Guard lock.acquire itself (a transient DB error here used to be an
      // unhandled rejection under `void this.runTick()` — it must degrade like
      // every other tick failure, never kill the daemon).
      acquired = deps.lockEnabled ? await deps.lock.acquire(deps.clock.now(), deps.lockTtlMs) : true;
    } catch (err) {
      deps.log.error('tick.failed', { err });
      this.recordTick({
        ranAt: deps.clock.now(),
        durationMs: 0,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        extracted: 0,
        storiesUpserted: 0,
        signalsObserved: 0,
        skipped: [],
        failed: [],
        signalsSkipped: [],
        signalsFailed: [],
      });
      // An acquire-throw is not a lock-skip (that's `acquire()` resolving
      // false) — it's a failed attempt, so maintain still runs (ADR-0042).
      await deps.maintain().catch((err) => deps.log.error('maintain.failed', { err }));
      // The lock was never acquired, so there's nothing to release. The
      // backoff clock does not advance here either: no sources were
      // attempted this tick, unlike the failed-run path below.
      return;
    }
    if (!acquired) {
      deps.log.warn('tick.lock_skip', { reason: 'another process holds the tick lock' });
      // Make the skip visible in tick_reports (ADR-0048): a remote observer must
      // be able to tell "skipped by lock" from "process dead".
      this.recordTick(lockSkipRecord(deps.clock.now()));
      return;
    }
    const ranAt = deps.clock.now();
    // Observe→adapt (ADR-0052): skip Sources currently cooling down after repeated
    // failures, so a known-bad, rate-limited feed (e.g. GDELT 429) doesn't waste a
    // fetch this tick. They auto-retry when the cooldown lapses.
    const backedOff = deps.backoff.activeBackoffs(this.index);
    if (backedOff.size) deps.log.info('backoff.skip', { sources: [...backedOff] });
    // The persisted reflection policy (ADR-0053): a screened override the last
    // reflection imposed — read fresh each tick so it survives restarts.
    const policy = await deps.policy.get().catch(() => null);
    try {
      const report = await deps.runner.run({
        skipSources: backedOff,
        ...(policy?.deepAnalysisTopN ? { deepAnalysisTopN: policy.deepAnalysisTopN } : {}),
      });
      this.recordTick({
        ...report,
        ranAt,
        durationMs: deps.clock.now() - ranAt,
        ok: true,
        error: null,
      });
      // Feed the outcome back into the loop: sources attempted this tick that
      // failed or were health-skipped advance toward backoff; successes reset.
      // Signal sources count too (ADR-0054) — a 429-ing signal feed can rest.
      const attempted = deps.sourceIds.filter((id) => !backedOff.has(id));
      const bad = [
        ...report.skipped,
        ...report.failed.map((f) => f.source),
        ...report.signalsSkipped,
        ...report.signalsFailed.map((f) => f.source),
      ];
      const newly = deps.backoff.record(this.index, attempted, bad);
      if (newly.length) deps.log.warn('backoff.engaged', { sources: newly });
      deps.log.info('tick.ok', {
        extracted: report.extracted,
        stories: report.storiesUpserted,
        signals: report.signalsObserved,
        skipped: report.skipped,
        failed: report.failed.map((f) => f.source),
      });
      // Steady-state healing (ADR-0038): e.g. deep-analyze a few cached Stories
      // still missing a summary, so the whole cache converges over time.
      if (deps.afterTick) await deps.afterTick();
    } catch (err) {
      // Record the failed tick too (ADR-0033), then keep the loop alive.
      this.recordTick({
        ranAt,
        durationMs: deps.clock.now() - ranAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        extracted: 0,
        storiesUpserted: 0,
        signalsObserved: 0,
        skipped: [],
        failed: [],
        signalsSkipped: [],
        signalsFailed: [],
      });
      deps.log.error('tick.failed', { err }); // never let a bad tick kill the loop
    } finally {
      // Retention + reflection run whether or not the tick itself succeeded, so a
      // failing tick is still counted, pruned, and reflected on (ADR-0042).
      await deps.maintain().catch((err) => deps.log.error('maintain.failed', { err }));
      if (deps.lockEnabled) {
        await deps.lock.release().catch((err) => deps.log.error('tick.lock_release_failed', { err }));
      }
      this.index += 1; // advance the backoff clock once per attempted (non-lock-skipped) tick
    }
  }
}
