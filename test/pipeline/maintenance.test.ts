import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import {
  maybeReflect,
  runMaintenanceSteps,
  type ReflectionBackoff,
  type ReflectionDeps,
} from '../../src/pipeline/maintenance.js';
import { screenReflectionActions } from '../../src/pipeline/reflection-policy.js';
import { DrizzleTickReportRepo, type TickRecord } from '../../src/db/tick-report-repo.js';
import { DrizzleTickReflectionRepo } from '../../src/db/tick-reflection-repo.js';
import { DrizzleAgentPolicyRepo } from '../../src/db/agent-policy-repo.js';
import { nullLogger } from '../../src/log/logger.js';
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
