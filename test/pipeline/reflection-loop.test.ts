import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { TickLoop, type TickLoopDeps, type TickLoopRunner } from '../../src/scheduler/tick-loop.js';
import { maybeReflect } from '../../src/pipeline/maintenance.js';
import { screenReflectionActions } from '../../src/pipeline/reflection-policy.js';
import { AdaptiveBackoff } from '../../src/pipeline/adaptive-backoff.js';
import { DrizzleTickReportRepo } from '../../src/db/tick-report-repo.js';
import { DrizzleTickReflectionRepo } from '../../src/db/tick-reflection-repo.js';
import { DrizzleAgentPolicyRepo } from '../../src/db/agent-policy-repo.js';
import { nullLogger } from '../../src/log/logger.js';
import type { Reflection } from '../../src/llm/llm-client.js';
import type { TickReport } from '../../src/pipeline/tick-runner.js';
import type { SourceId } from '../../src/domain/types.js';

const REPORT: TickReport = {
  extracted: 1,
  skipped: [],
  failed: [],
  storiesUpserted: 1,
  signalsObserved: 0,
  signalsSkipped: [],
  signalsFailed: [],
};

/**
 * Drives the real TickLoop + real maintenance/policy/backoff stack end to
 * end: a fake `reflect` proposes out-of-bounds actions, the deterministic
 * screen clamps them, `maybeReflect` applies them, and the very next tick
 * must observably pick up the clamped values via TickLoop's per-tick reads
 * (ADR-0053) — not just via the receipt.
 */
describe('reflection loop end-to-end (ADR-0042/0053)', () => {
  it('a screened reflection changes what the next tick receives, and the receipt records the clamped actions', async () => {
    const db = await createTestDb();
    const tickReportRepo = new DrizzleTickReportRepo(db);
    const tickReflectionRepo = new DrizzleTickReflectionRepo(db);
    const agentPolicyRepo = new DrizzleAgentPolicyRepo(db);
    const backoff = new AdaptiveBackoff({ threshold: 3, cooldownTicks: 5 });
    const clock = new FakeClock(1_000);

    const runCalls: { skipSources: ReadonlySet<SourceId>; deepAnalysisTopN?: number }[] = [];
    const runner: TickLoopRunner = {
      run: async (opts) => {
        runCalls.push(opts);
        return REPORT;
      },
    };

    // The model proposes an out-of-bounds backoff (99 ticks, max is 10) and an
    // out-of-bounds top-N override (1, min is 3) — the screen must clamp both.
    const reflection: Reflection = {
      advisory: '',
      actions: [
        { type: 'backoff_source', source: 'gdelt', ticks: 99, reason: 'repeated 429s' },
        { type: 'set_deep_analysis_top_n', value: 1, reason: 'save budget' },
      ],
    };

    const loopRef: { current?: TickLoop } = {};
    const deps: TickLoopDeps = {
      runner,
      lock: { acquire: async () => true, release: async () => undefined },
      lockEnabled: false,
      lockTtlMs: 60_000,
      clock,
      reports: tickReportRepo,
      backoff,
      sourceIds: ['gdelt', 'hackernews'],
      policy: agentPolicyRepo,
      maintain: () =>
        maybeReflect({
          reflect: async () => reflection,
          screen: screenReflectionActions,
          backoff,
          agentPolicyRepo,
          tickReflectionRepo,
          tickReportRepo,
          log: nullLogger,
          now: () => clock.now(),
          nextTickIndex: () => (loopRef.current?.tickIndex() ?? 0) + 1,
          validSources: ['gdelt', 'hackernews'],
          reflectEveryTicks: 1,
          reflectWindow: 5,
          reflectionsRetention: 20,
        }),
      log: nullLogger,
    };
    const loop = new TickLoop(deps);
    loopRef.current = loop;

    // Tick 1: runs clean (nothing backed off yet, no policy override yet),
    // then maintain() reflects on the single persisted report and applies
    // the (clamped) actions for the next tick to pick up.
    await loop.runTick();
    expect(runCalls[0]).toMatchObject({ skipSources: new Set() });
    expect(runCalls[0]?.deepAnalysisTopN).toBeUndefined();

    // Tick 2: TickLoop reads activeBackoffs() and the persisted policy fresh
    // (tick-loop.ts ~146-150) — gdelt must now be in the skip set and topN
    // clamped to the policy floor of 3, not the model's requested 1.
    await loop.runTick();
    expect(runCalls[1]?.skipSources.has('gdelt' as SourceId)).toBe(true);
    expect(runCalls[1]?.deepAnalysisTopN).toBe(3);

    // The receipt persists the actions actually applied — clamped, not raw.
    const [receipt] = await tickReflectionRepo.recent(10);
    expect(receipt?.actions).toEqual([
      { type: 'backoff_source', reason: 'repeated 429s', source: 'gdelt', ticks: 10 },
      { type: 'set_deep_analysis_top_n', reason: 'save budget', value: 3 },
    ]);
  });

  it('does not reflect when no tick has ever been persisted (count === 0 guard)', async () => {
    const db = await createTestDb();
    const tickReportRepo = new DrizzleTickReportRepo(db);
    const tickReflectionRepo = new DrizzleTickReflectionRepo(db);
    const agentPolicyRepo = new DrizzleAgentPolicyRepo(db);
    let calls = 0;

    await maybeReflect({
      reflect: async () => {
        calls += 1;
        return { advisory: '', actions: [] };
      },
      screen: screenReflectionActions,
      backoff: { force: () => undefined },
      agentPolicyRepo,
      tickReflectionRepo,
      tickReportRepo,
      log: nullLogger,
      now: () => 1,
      nextTickIndex: () => 1,
      validSources: [],
      reflectEveryTicks: 1,
      reflectWindow: 5,
      reflectionsRetention: 20,
    });

    expect(calls).toBe(0);
    expect(await tickReflectionRepo.recent(10)).toEqual([]);
  });
});
