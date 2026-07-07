import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import {
  maybeReflect,
  maybeRevertPolicy,
  runMaintenanceSteps,
  type ReflectionBackoff,
  type ReflectionDeps,
} from '../../src/pipeline/maintenance.js';
import { screenReflectionActions } from '../../src/pipeline/reflection-policy.js';
import { DrizzleTickReportRepo, type TickRecord } from '../../src/db/tick-report-repo.js';
import { DrizzleTickReflectionRepo } from '../../src/db/tick-reflection-repo.js';
import { DrizzleAgentPolicyRepo } from '../../src/db/agent-policy-repo.js';
import { nullLogger } from '../../src/log/logger.js';
import { Reasoner } from '../../src/llm/reasoner.js';
import type { ChatTransport, CompletionOptions } from '../../src/llm/chat-transport.js';
import type { Reflection } from '../../src/llm/llm-client.js';
import type { Db } from '../../src/db/client.js';

function record(over: Partial<TickRecord> = {}): TickRecord {
  return {
    ranAt: 1000,
    durationMs: 250,
    ok: true,
    error: null,
    extracted: 40,
    storiesUpserted: 12,
    signalsObserved: 8,
    skipped: [],
    failed: [],
    signalsSkipped: [],
    signalsFailed: [],
    ...over,
  };
}

/** A no-op backoff spy; tests inspect `.calls`. */
function fakeBackoff(): ReflectionBackoff & { calls: { source: string; fromTick: number; ticks: number }[] } {
  const calls: { source: string; fromTick: number; ticks: number }[] = [];
  return {
    calls,
    force: (source, fromTick, ticks) => {
      calls.push({ source, fromTick, ticks });
    },
  };
}

async function harness(db: Db) {
  return {
    tickReportRepo: new DrizzleTickReportRepo(db),
    tickReflectionRepo: new DrizzleTickReflectionRepo(db),
    agentPolicyRepo: new DrizzleAgentPolicyRepo(db),
  };
}

const emptyReflection: Reflection = { advisory: '', actions: [] };

describe('maybeReflect (ADR-0042/0053)', () => {
  it('records a receipt when actions were applied even with empty advisory text', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);
    await tickReportRepo.record(record());
    const backoff = fakeBackoff();

    await maybeReflect({
      reflect: async () => ({
        advisory: '   ', // whitespace-only — must not gate the receipt
        actions: [{ type: 'backoff_source', source: 'gdelt', ticks: 3, reason: 'flaky' }],
      }),
      screen: screenReflectionActions,
      backoff,
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 5000,
      nextTickIndex: () => 7,
      validSources: ['gdelt'],
      reflectEveryTicks: 1,
      reflectWindow: 5,
      reflectionsRetention: 20,
    });

    expect(backoff.calls).toEqual([{ source: 'gdelt', fromTick: 7, ticks: 3 }]);
    const [receipt] = await tickReflectionRepo.recent(10);
    expect(receipt).toBeDefined();
    expect(receipt?.text).toBe(''); // trimmed advisory persisted as-is
    expect(receipt?.actions).toEqual([
      { type: 'backoff_source', reason: 'flaky', source: 'gdelt', ticks: 3 },
    ]);
  });

  it('does not record a receipt when there is no advisory text and no accepted actions', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);
    await tickReportRepo.record(record());

    await maybeReflect({
      reflect: async () => emptyReflection,
      screen: screenReflectionActions,
      backoff: fakeBackoff(),
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 5000,
      nextTickIndex: () => 1,
      validSources: [],
      reflectEveryTicks: 1,
      reflectWindow: 5,
      reflectionsRetention: 20,
    });

    expect(await tickReflectionRepo.recent(10)).toEqual([]);
  });

  it('reflection cadence derives from persisted tick count, not process lifetime', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);
    let calls = 0;
    const deps = {
      reflect: async () => {
        calls += 1;
        return emptyReflection;
      },
      screen: screenReflectionActions,
      backoff: fakeBackoff(),
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 1,
      nextTickIndex: () => 1,
      validSources: [],
      reflectEveryTicks: 3,
      reflectWindow: 5,
      reflectionsRetention: 20,
    };

    // First "process lifetime": two ticks, cadence not yet due.
    await tickReportRepo.record(record({ ranAt: 1 }));
    await maybeReflect(deps); // persisted count 1 — not yet
    await tickReportRepo.record(record({ ranAt: 2 }));
    await maybeReflect(deps); // persisted count 2 — not yet
    expect(calls).toBe(0);

    // "Restart": re-import the module fresh so any in-process module-level
    // state (e.g. a `let tickCount` closure) is wiped, exactly like a deploy
    // restarting the Node process — but the DB survives. A durable-count
    // cadence must still fire on the very next tick; an in-memory counter
    // would restart at 0/1 and miss it (the audit finding this guards).
    vi.resetModules();
    const fresh = await import('../../src/pipeline/maintenance.js');
    await tickReportRepo.record(record({ ranAt: 3 }));
    await fresh.maybeReflect(deps as ReflectionDeps); // persisted count 3 — reflects

    expect(calls).toBe(1);
  });

  it('reflection cadence keeps advancing after tick_reports is pruned to the '
    + 'retention cap (post-ship hardening-pass regression: count() pins at the '
    + 'cap once pruning kicks in, so a count-based cadence either fires every '
    + 'tick or goes dead forever)', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);
    let calls = 0;
    const deps = {
      reflect: async () => {
        calls += 1;
        return emptyReflection;
      },
      screen: screenReflectionActions,
      backoff: fakeBackoff(),
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 1,
      nextTickIndex: () => 1,
      validSources: [],
      reflectEveryTicks: 3,
      reflectWindow: 5,
      reflectionsRetention: 20,
    };
    const CAP = 5;

    // Seed well past the retention cap, exactly like a long-running deploy
    // would: ids 1..10, cap prunes it down to the most recent 5 (ids 6..10)
    // every maintenance cycle, same as `main.ts`'s `maintain()` does before
    // calling `maybeReflect` in the same cycle.
    for (let i = 1; i <= 10; i += 1) {
      await tickReportRepo.record(record({ ranAt: i }));
    }
    await tickReportRepo.pruneToRecent(CAP);
    expect(await tickReportRepo.count()).toBe(CAP); // pinned at the cap from here on

    // Simulate 6 more maintenance cycles: prune-to-cap then maybeReflect, in
    // that order, each cycle — matching main.ts's step sequence. ids run
    // 11..16; reflectEveryTicks=3 means ids 12 and 15 should each fire once.
    for (let i = 11; i <= 16; i += 1) {
      await tickReportRepo.record(record({ ranAt: i }));
      await tickReportRepo.pruneToRecent(CAP);
      expect(await tickReportRepo.count()).toBe(CAP); // still pinned — count() alone is useless here
      await maybeReflect(deps);
    }

    // ids 12 and 15 are the only multiples of 3 in 11..16 → exactly 2
    // reflections. A count()-based cadence would instead be pinned at
    // count()=5 forever (5 % 3 !== 0), so it would never reflect again once
    // pruning kicked in — the regression this test guards against.
    expect(calls).toBe(2);
  });

  it('merges a single-knob override onto the persisted policy without clobbering the others (ADR-0061)', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);
    await tickReportRepo.record(record());
    // A prior reflection already tightened the deep-analysis budget.
    await agentPolicyRepo.set(
      { deepAnalysisTopN: 5, confirmConcurrency: null, candidateThreshold: null, reason: 'earlier' },
      100,
    );

    // This reflection only touches confirm concurrency — the topN override must survive.
    await maybeReflect({
      reflect: async () => ({
        advisory: '',
        actions: [{ type: 'set_confirm_concurrency', value: 4, reason: 'ticks slow' }],
      }),
      screen: screenReflectionActions,
      backoff: fakeBackoff(),
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 5000,
      nextTickIndex: () => 1,
      validSources: [],
      reflectEveryTicks: 1,
      reflectWindow: 5,
      reflectionsRetention: 20,
    });

    const policy = await agentPolicyRepo.get();
    expect(policy?.deepAnalysisTopN).toBe(5); // preserved
    expect(policy?.confirmConcurrency).toBe(4); // applied
    expect(policy?.candidateThreshold).toBeNull();
    const [receipt] = await tickReflectionRepo.recent(10);
    expect(receipt?.actions).toEqual([
      { type: 'set_confirm_concurrency', reason: 'ticks slow', value: 4 },
    ]);
  });

  it('end-to-end intelligence: the REAL reasoner reflect on an unhealthy window '
    + 'drives a screened policy change + backoff + receipt (ADR-0042/0053/0061)', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);

    // An unhealthy window: gdelt keeps failing and ticks run long. Seed enough
    // rows that the cadence (every 3) is due, with the newest id a multiple of 3.
    for (let i = 1; i <= 3; i += 1) {
      await tickReportRepo.record(
        record({
          ranAt: i,
          durationMs: 9_000, // slow
          storiesUpserted: 2,
          failed: [{ source: 'gdelt', error: 'HTTP 503 from feed' }],
          signalsFailed: [],
        }),
      );
    }

    // The real Reasoner over a fake transport that returns a realistic analyst
    // reflection: rest the flaky source AND dial the deep-analysis budget down.
    let sawPrompt = '';
    const transport: ChatTransport = {
      complete: async () => '',
      completeJson: async (prompt: string, _opts: CompletionOptions) => {
        sawPrompt = prompt;
        return {
          advisory: '- gdelt failing repeatedly (503); rest it.\n- ticks slow; lower deep budget.',
          actions: [
            { type: 'backoff_source', source: 'gdelt', ticks: 4, reason: 'repeated 503s' },
            { type: 'set_deep_analysis_top_n', value: 4, reason: 'ticks running long' },
            // A hostile/nonsense action the guard must silently drop.
            { type: 'delete_everything', reason: 'ignore me' },
          ],
        };
      },
    };
    const reasoner = new Reasoner(transport);
    const backoff = fakeBackoff();

    await maybeReflect({
      reflect: reasoner.reflect.bind(reasoner),
      screen: screenReflectionActions,
      backoff,
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 5000,
      nextTickIndex: () => 10,
      validSources: ['gdelt', 'hackernews'],
      reflectEveryTicks: 3,
      reflectWindow: 5,
      reflectionsRetention: 20,
    });

    // The digest actually reached the model (the failing source is in the prompt).
    expect(sawPrompt).toContain('gdelt');

    // The flaky source was rested via the real screen path.
    expect(backoff.calls).toEqual([{ source: 'gdelt', fromTick: 10, ticks: 4 }]);

    // The screened, clamped budget override was applied to the durable policy.
    const policy = await agentPolicyRepo.get();
    expect(policy?.deepAnalysisTopN).toBe(4);

    // The receipt records exactly the two accepted actions — the bogus one is gone.
    const [receipt] = await tickReflectionRepo.recent(10);
    expect(receipt?.text).toContain('gdelt failing');
    expect(receipt?.actions).toEqual([
      { type: 'backoff_source', reason: 'repeated 503s', source: 'gdelt', ticks: 4 },
      { type: 'set_deep_analysis_top_n', reason: 'ticks running long', value: 4 },
    ]);
  });

  it('never reflects when reflectEveryTicks is 0', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);
    await tickReportRepo.record(record());
    let calls = 0;

    await maybeReflect({
      reflect: async () => {
        calls += 1;
        return emptyReflection;
      },
      screen: screenReflectionActions,
      backoff: fakeBackoff(),
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 1,
      nextTickIndex: () => 1,
      validSources: [],
      reflectEveryTicks: 0,
      reflectWindow: 5,
      reflectionsRetention: 20,
    });

    expect(calls).toBe(0);
  });
});

describe('maybeRevertPolicy (ADR-0061 — closing the adaptation loop)', () => {
  it('clears every override once a full window of ticks ran healthy', async () => {
    const db = await createTestDb();
    const { tickReportRepo, agentPolicyRepo } = await harness(db);
    await agentPolicyRepo.set(
      { deepAnalysisTopN: 5, confirmConcurrency: 4, candidateThreshold: 0.85, reason: 'stress' },
      100,
    );
    for (let i = 1; i <= 3; i += 1) await tickReportRepo.record(record({ ranAt: i }));

    await maybeRevertPolicy({
      agentPolicyRepo,
      tickReportRepo,
      now: () => 9000,
      healthyWindow: 3,
      log: nullLogger,
    });

    const policy = await agentPolicyRepo.get();
    expect(policy?.deepAnalysisTopN).toBeNull();
    expect(policy?.confirmConcurrency).toBeNull();
    expect(policy?.candidateThreshold).toBeNull();
    expect(policy?.reason).toContain('auto-reverted');
  });

  it('leaves the override in place while a recent tick still failed', async () => {
    const db = await createTestDb();
    const { tickReportRepo, agentPolicyRepo } = await harness(db);
    await agentPolicyRepo.set(
      { deepAnalysisTopN: 5, confirmConcurrency: null, candidateThreshold: null, reason: 'stress' },
      100,
    );
    await tickReportRepo.record(record({ ranAt: 1, ok: false, error: 'boom' }));
    await tickReportRepo.record(record({ ranAt: 2 }));
    await tickReportRepo.record(record({ ranAt: 3 }));

    await maybeRevertPolicy({
      agentPolicyRepo,
      tickReportRepo,
      now: () => 9000,
      healthyWindow: 3,
      log: nullLogger,
    });

    expect((await agentPolicyRepo.get())?.deepAnalysisTopN).toBe(5); // still held
  });

  it('is a no-op when no override is set (nothing to revert)', async () => {
    const db = await createTestDb();
    const { tickReportRepo, agentPolicyRepo } = await harness(db);
    for (let i = 1; i <= 5; i += 1) await tickReportRepo.record(record({ ranAt: i }));

    await maybeRevertPolicy({
      agentPolicyRepo,
      tickReportRepo,
      now: () => 9000,
      healthyWindow: 3,
      log: nullLogger,
    });

    expect(await agentPolicyRepo.get()).toBeNull(); // no row ever written
  });

  it('waits for a full window of evidence before reverting', async () => {
    const db = await createTestDb();
    const { tickReportRepo, agentPolicyRepo } = await harness(db);
    await agentPolicyRepo.set(
      { deepAnalysisTopN: 5, confirmConcurrency: null, candidateThreshold: null, reason: 'stress' },
      100,
    );
    await tickReportRepo.record(record({ ranAt: 1 })); // only 1 healthy tick, window is 3

    await maybeRevertPolicy({
      agentPolicyRepo,
      tickReportRepo,
      now: () => 9000,
      healthyWindow: 3,
      log: nullLogger,
    });

    expect((await agentPolicyRepo.get())?.deepAnalysisTopN).toBe(5);
  });
});

describe('maintenance orchestration — the closed adaptation loop main.ts wires (ADR-0061)', () => {
  it('a reflection tightens a knob, then a healthy stretch auto-reverts it, driven by runMaintenanceSteps', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);
    const backoff = fakeBackoff();

    // The two maintenance steps exactly as main.ts composes them into `maintain`.
    const reflectStep = (reflect: ReflectionDeps['reflect']) => ({
      name: 'reflect',
      run: async () => {
        await maybeReflect({
          reflect,
          screen: screenReflectionActions,
          backoff,
          agentPolicyRepo,
          tickReflectionRepo,
          tickReportRepo,
          log: nullLogger,
          now: () => 1000,
          nextTickIndex: () => 1,
          validSources: [],
          reflectEveryTicks: 1,
          reflectWindow: 3,
          reflectionsRetention: 20,
        });
      },
    });
    const revertStep = {
      name: 'revert',
      run: () =>
        maybeRevertPolicy({
          agentPolicyRepo,
          tickReportRepo,
          now: () => 2000,
          healthyWindow: 3,
          log: nullLogger,
        }),
    };

    // Cycle 1 — one struggling tick; the model dials the deep budget down.
    await tickReportRepo.record(record({ ranAt: 1, ok: false, error: 'slow', durationMs: 9000 }));
    await runMaintenanceSteps(
      [
        reflectStep(async () => ({
          advisory: 'ticks slow',
          actions: [{ type: 'set_deep_analysis_top_n', value: 4, reason: 'slow' }],
        })),
        revertStep, // no-op: only one tick, and it failed
      ],
      nullLogger,
    );
    expect((await agentPolicyRepo.get())?.deepAnalysisTopN).toBe(4); // override imposed

    // Cycles 2-3 — healthy ticks accrue but the model proposes nothing new.
    for (let i = 2; i <= 3; i += 1) {
      await tickReportRepo.record(record({ ranAt: i, ok: true }));
      await runMaintenanceSteps(
        [reflectStep(async () => emptyReflection), revertStep],
        nullLogger,
      );
    }
    // Still held: the failed tick 1 is inside the 3-tick health window.
    expect((await agentPolicyRepo.get())?.deepAnalysisTopN).toBe(4);

    // Cycle 4 — the window is now three consecutive healthy ticks (2,3,4).
    await tickReportRepo.record(record({ ranAt: 4, ok: true }));
    await runMaintenanceSteps(
      [reflectStep(async () => emptyReflection), revertStep],
      nullLogger,
    );

    const policy = await agentPolicyRepo.get();
    expect(policy?.deepAnalysisTopN).toBeNull(); // auto-reverted once recovery was sustained
    expect(policy?.reason).toContain('auto-reverted');
  });

  it('a fresh override imposed on an already-healthy window is NOT cleared the same '
    + 'cycle — the gated revert stands down (Bugbot regression, ADR-0061)', async () => {
    const db = await createTestDb();
    const { tickReportRepo, tickReflectionRepo, agentPolicyRepo } = await harness(db);

    // A fully healthy window: nothing failed. Without the gate, revert would fire
    // in the same pass reflection imposes an override and immediately clear it.
    for (let i = 1; i <= 3; i += 1) await tickReportRepo.record(record({ ranAt: i, ok: true }));

    // main.ts's exact reflect→revert coordination: a cycle-local flag lets the
    // fresh override survive the same pass.
    let appliedPolicyOverrideThisCycle = false;
    await runMaintenanceSteps(
      [
        {
          name: 'reflect',
          run: async () => {
            const outcome = await maybeReflect({
              reflect: async () => ({
                advisory: 'spend high; trim deep budget even though ticks are ok',
                actions: [{ type: 'set_deep_analysis_top_n', value: 4, reason: 'cost' }],
              }),
              screen: screenReflectionActions,
              backoff: fakeBackoff(),
              agentPolicyRepo,
              tickReflectionRepo,
              tickReportRepo,
              log: nullLogger,
              now: () => 1000,
              nextTickIndex: () => 1,
              validSources: [],
              reflectEveryTicks: 1,
              reflectWindow: 3,
              reflectionsRetention: 20,
            });
            appliedPolicyOverrideThisCycle = outcome.appliedPolicyOverride;
          },
        },
        {
          name: 'revert',
          run: async () => {
            if (appliedPolicyOverrideThisCycle) return;
            await maybeRevertPolicy({
              agentPolicyRepo,
              tickReportRepo,
              now: () => 2000,
              healthyWindow: 3,
              log: nullLogger,
            });
          },
        },
      ],
      nullLogger,
    );

    // The override survives the cycle it was set in.
    expect((await agentPolicyRepo.get())?.deepAnalysisTopN).toBe(4);

    // A later healthy cycle with no new reflection DOES relax it.
    await tickReportRepo.record(record({ ranAt: 4, ok: true }));
    await maybeRevertPolicy({
      agentPolicyRepo,
      tickReportRepo,
      now: () => 3000,
      healthyWindow: 3,
      log: nullLogger,
    });
    expect((await agentPolicyRepo.get())?.deepAnalysisTopN).toBeNull();
  });
});

describe('runMaintenanceSteps (ADR-0054 audit fix)', () => {
  it('a failing prune step does not prevent reflection from running', async () => {
    const order: string[] = [];
    const errors: { step: string; err: unknown }[] = [];
    const log = {
      info: () => undefined,
      warn: () => undefined,
      error: (_event: string, fields?: Record<string, unknown>) => {
        errors.push({ step: String(fields?.step), err: fields?.err });
      },
    };

    await runMaintenanceSteps(
      [
        { name: 'tickReports', run: async () => { order.push('tickReports'); throw new Error('boom'); } },
        { name: 'webAuth', run: async () => { order.push('webAuth'); } },
        { name: 'rawItems', run: async () => { order.push('rawItems'); } },
        { name: 'chatTrace', run: async () => { order.push('chatTrace'); } },
        { name: 'chatSession', run: async () => { order.push('chatSession'); } },
        { name: 'reflect', run: async () => { order.push('reflect'); } },
      ],
      log,
    );

    expect(order).toEqual(['tickReports', 'webAuth', 'rawItems', 'chatTrace', 'chatSession', 'reflect']);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.step).toBe('tickReports');
    expect(errors[0]?.err).toBeInstanceOf(Error);
  });

  it('logs each failing step independently and still runs every step', async () => {
    const order: string[] = [];
    let failures = 0;
    const log = {
      info: () => undefined,
      warn: () => undefined,
      error: () => { failures += 1; },
    };

    await runMaintenanceSteps(
      [
        { name: 'a', run: async () => { order.push('a'); throw new Error('a-fail'); } },
        { name: 'b', run: async () => { order.push('b'); throw new Error('b-fail'); } },
        { name: 'c', run: async () => { order.push('c'); } },
      ],
      log,
    );

    expect(order).toEqual(['a', 'b', 'c']);
    expect(failures).toBe(2);
  });
});
