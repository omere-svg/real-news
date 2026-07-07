import { describe, expect, it, vi } from 'vitest';
import { TickLoop, type TickLoopDeps } from '../../src/scheduler/tick-loop.js';
import type { TickRecord } from '../../src/db/tick-report-repo.js';
import type { TickReport } from '../../src/pipeline/tick-runner.js';
import type { SourceId } from '../../src/domain/types.js';
import type { Logger } from '../../src/log/logger.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** Let pending microtasks/immediates run so an in-flight tick reaches its await. */
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

const REPORT: TickReport = {
  extracted: 5,
  skipped: [],
  failed: [],
  storiesUpserted: 2,
  signalsObserved: 1,
  signalsSkipped: [],
  signalsFailed: [],
};

function spyLogger(): Logger & { events: (level: string) => string[] } {
  const calls: { level: string; event: string }[] = [];
  return {
    info: (event) => calls.push({ level: 'info', event }),
    warn: (event) => calls.push({ level: 'warn', event }),
    error: (event) => calls.push({ level: 'error', event }),
    events: (level) => calls.filter((c) => c.level === level).map((c) => c.event),
  };
}

/** A full deps object with benign fakes; tests override what they exercise. */
function makeDeps(overrides: Partial<TickLoopDeps> = {}): {
  deps: TickLoopDeps;
  recorded: TickRecord[];
  log: ReturnType<typeof spyLogger>;
} {
  const recorded: TickRecord[] = [];
  const log = spyLogger();
  const deps: TickLoopDeps = {
    runner: { run: async () => REPORT },
    lock: { acquire: async () => true, release: async () => undefined },
    lockEnabled: true,
    lockTtlMs: 60_000,
    clock: new FakeClock(1_000),
    reports: {
      record: async (rec) => {
        recorded.push(rec);
      },
    },
    backoff: { activeBackoffs: () => new Set<SourceId>(), record: () => [] },
    sourceIds: ['hackernews', 'gdelt'],
    policy: { get: async () => null },
    maintain: async () => undefined,
    log,
    ...overrides,
  };
  return { deps, recorded, log };
}

describe('TickLoop', () => {
  it('records a lock-skip record (ok, with reason) when another process holds the lock — and neither runs nor maintains', async () => {
    const run = vi.fn();
    const maintain = vi.fn();
    const { deps, recorded, log } = makeDeps({
      lock: { acquire: async () => false, release: async () => undefined },
      runner: { run },
      maintain,
    });
    const loop = new TickLoop(deps);
    await loop.runTick();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ ok: true, error: expect.stringMatching(/lock/) });
    expect(run).not.toHaveBeenCalled();
    expect(maintain).not.toHaveBeenCalled(); // a lock-skipped interval belongs to the holder
    expect(loop.tickIndex()).toBe(0); // the backoff clock does not advance
    expect(log.events('warn')).toContain('tick.lock_skip');
  });

  it('a throwing run records a FAILED tick, maintain still runs, and the lock is released', async () => {
    const maintain = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const { deps, recorded, log } = makeDeps({
      runner: {
        run: async () => {
          throw new Error('pipeline exploded');
        },
      },
      lock: { acquire: async () => true, release },
      maintain,
    });
    const loop = new TickLoop(deps);
    await loop.runTick();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ ok: false, error: 'pipeline exploded', extracted: 0 });
    expect(maintain).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(loop.tickIndex()).toBe(1);
    expect(log.events('error')).toContain('tick.failed');
  });

  it('releases the lock on the success path too, and records the tick outcome', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const { deps, recorded, log } = makeDeps({
      lock: { acquire: async () => true, release },
    });
    const loop = new TickLoop(deps);
    await loop.runTick();

    expect(recorded[0]).toMatchObject({ ok: true, error: null, extracted: 5, storiesUpserted: 2 });
    expect(release).toHaveBeenCalledTimes(1);
    expect(log.events('info')).toContain('tick.ok');
  });

  it('never touches the lock when lockEnabled is false', async () => {
    const acquire = vi.fn();
    const release = vi.fn();
    const { deps, recorded } = makeDeps({ lockEnabled: false, lock: { acquire, release } });
    await new TickLoop(deps).runTick();
    expect(acquire).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(recorded[0]).toMatchObject({ ok: true });
  });

  it('an overlapping runTick is skipped while the previous tick is still running', async () => {
    let resolveRun: (r: TickReport) => void = () => undefined;
    const run = vi.fn(() => new Promise<TickReport>((r) => (resolveRun = r)));
    const { deps, log } = makeDeps({ runner: { run } });
    const loop = new TickLoop(deps);

    const first = loop.runTick();
    await flush(); // the first tick is now blocked inside run()
    await loop.runTick(); // interval fired again mid-tick
    expect(run).toHaveBeenCalledTimes(1);
    expect(log.events('warn')).toContain('tick.overlap_skip');

    resolveRun(REPORT);
    await first;
    const third = loop.runTick(); // after completion, ticking resumes
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    resolveRun(REPORT);
    await third;
  });

  it('feeds backoff outcomes forward: active backoffs are skipped, results are recorded against attempted sources', async () => {
    const run = vi.fn().mockResolvedValue({
      ...REPORT,
      skipped: ['knesset' as SourceId],
      failed: [{ source: 'arxiv' as SourceId, error: 'boom' }],
    });
    const backoffRecord = vi.fn().mockReturnValue(['arxiv' as SourceId]);
    const { deps, log } = makeDeps({
      runner: { run },
      sourceIds: ['hackernews', 'gdelt', 'knesset', 'arxiv'],
      backoff: {
        activeBackoffs: (tick) => (tick === 0 ? new Set<SourceId>(['gdelt']) : new Set()),
        record: backoffRecord,
      },
    });
    const loop = new TickLoop(deps);
    await loop.runTick();

    // The cooling-down source is excluded from the run and from `attempted`.
    expect(run.mock.calls[0]?.[0].skipSources).toEqual(new Set(['gdelt']));
    expect(backoffRecord).toHaveBeenCalledWith(
      0,
      ['hackernews', 'knesset', 'arxiv'],
      ['knesset', 'arxiv'], // health-skipped + failed both advance the streak
    );
    expect(log.events('info')).toContain('backoff.skip');
    expect(log.events('warn')).toContain('backoff.engaged'); // newly backed off
  });

  it('passes the persisted deepAnalysisTopN policy override into run(); a failing policy read degrades to none', async () => {
    const run = vi.fn().mockResolvedValue(REPORT);
    const { deps } = makeDeps({
      runner: { run },
      policy: {
        get: async () => ({ deepAnalysisTopN: 7, confirmConcurrency: null, candidateThreshold: null }),
      },
    });
    await new TickLoop(deps).runTick();
    expect(run.mock.calls[0]?.[0]).toMatchObject({ deepAnalysisTopN: 7 });

    const runNoPolicy = vi.fn().mockResolvedValue(REPORT);
    const { deps: deps2 } = makeDeps({
      runner: { run: runNoPolicy },
      policy: {
        get: async () => {
          throw new Error('db read failed');
        },
      },
    });
    await new TickLoop(deps2).runTick();
    expect('deepAnalysisTopN' in (runNoPolicy.mock.calls[0]?.[0] ?? {})).toBe(false);
  });

  it('runs afterTick on the success path only', async () => {
    const afterTick = vi.fn().mockResolvedValue(undefined);
    const { deps } = makeDeps({ afterTick });
    await new TickLoop(deps).runTick();
    expect(afterTick).toHaveBeenCalledTimes(1);

    const afterFailed = vi.fn();
    const { deps: deps2 } = makeDeps({
      afterTick: afterFailed,
      runner: {
        run: async () => {
          throw new Error('nope');
        },
      },
    });
    await new TickLoop(deps2).runTick();
    expect(afterFailed).not.toHaveBeenCalled();
  });

  it('runExclusive serializes injected work with ticks (one pipeline queue, ADR-0047)', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const { deps } = makeDeps({
      runner: {
        run: async () => {
          order.push('tick-start');
          await new Promise<void>((r) => (release = r));
          order.push('tick-end');
          return REPORT;
        },
      },
    });
    const loop = new TickLoop(deps);

    const tick = loop.runTick();
    const queued = loop.runExclusive(async () => {
      order.push('backfill');
    });
    await flush(); // the tick is now blocked mid-run, holding the queue
    release();
    await Promise.all([tick, queued]);
    expect(order).toEqual(['tick-start', 'tick-end', 'backfill']);
  });

  it('a failing maintain is contained (logged) and the lock is still released', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const { deps, log } = makeDeps({
      maintain: async () => {
        throw new Error('prune failed');
      },
      lock: { acquire: async () => true, release },
    });
    await new TickLoop(deps).runTick();
    expect(release).toHaveBeenCalledTimes(1);
    expect(log.events('error')).toContain('maintain.failed');
  });

  it('tick loop survives a lock.acquire rejection and runs the next tick', async () => {
    let calls = 0;
    const acquire = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('DB connection reset');
      return true;
    });
    const release = vi.fn().mockResolvedValue(undefined);
    const maintain = vi.fn().mockResolvedValue(undefined);
    const { deps, recorded, log } = makeDeps({ lock: { acquire, release }, maintain });
    const loop = new TickLoop(deps);

    // The first tick's lock.acquire rejects — runTick must not itself reject
    // (an unhandled rejection here, per `void this.runTick()`, would kill the daemon).
    await expect(loop.runTick()).resolves.toBeUndefined();
    expect(log.events('error')).toContain('tick.failed');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ ok: false, error: expect.stringMatching(/DB connection reset/) });
    // An acquire-throw is not a lock-skip: maintain still runs, per the
    // class's maintain-always-runs invariant (ADR-0042).
    expect(maintain).toHaveBeenCalledTimes(1);

    // The loop is still alive: the next tick acquires the lock and runs normally.
    await loop.runTick();
    expect(log.events('info')).toContain('tick.ok');
    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toMatchObject({ ok: true });
  });

  it('resumes the backoff clock from the seeded index', async () => {
    const backoffRecord = vi.fn().mockReturnValue([]);
    const { deps } = makeDeps({
      initialTickIndex: 6,
      backoff: { activeBackoffs: () => new Set<SourceId>(), record: backoffRecord },
    });
    const loop = new TickLoop(deps);
    await loop.runTick();
    expect(backoffRecord).toHaveBeenCalledWith(6, expect.anything(), expect.anything());
    expect(loop.tickIndex()).toBe(7);
  });
});
