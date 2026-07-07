import type { SourceId } from '../domain/types.js';
import type { Reflector, TickDigest } from '../llm/llm-client.js';
import type { AgentPolicyRepo } from '../db/agent-policy-repo.js';
import type { TickReflectionRepo } from '../db/tick-reflection-repo.js';
import type { TickReportRepo, TickRecord } from '../db/tick-report-repo.js';
import type { StoredReflectionAction } from '../db/schema.js';
import type { Logger } from '../log/logger.js';
import { screenReflectionActions, type PolicyContext } from './reflection-policy.js';

/**
 * The slice of AdaptiveBackoff the reflection loop applies to (ADR-0053).
 * `fromTick` is the tick index the forced backoff should take effect from —
 * the caller supplies it (normally `tickLoop.tickIndex() + 1`) so this module
 * never has to depend on the scheduler.
 */
export interface ReflectionBackoff {
  force(source: SourceId, fromTick: number, ticks: number): void;
}

/** Everything the reflect-on-a-cadence step needs, injected so it is testable
 * without a live LLM, DB, or scheduler (ADR-0042/0053). */
export interface ReflectionDeps {
  readonly reflect: Reflector['reflect'];
  readonly screen: typeof screenReflectionActions;
  readonly backoff: ReflectionBackoff;
  readonly agentPolicyRepo: AgentPolicyRepo;
  readonly tickReflectionRepo: TickReflectionRepo;
  readonly tickReportRepo: TickReportRepo;
  readonly log: Logger;
  /** Wall clock, injected for deterministic tests. */
  readonly now: () => number;
  /** The tick index a forced backoff should take effect from. */
  readonly nextTickIndex: () => number;
  /** Source ids the pipeline actually runs — anything else the model proposes is rejected. */
  readonly validSources: readonly SourceId[];
  /** Reflect every N persisted tick_reports rows; 0 disables reflection entirely. */
  readonly reflectEveryTicks: number;
  /** How many trailing ticks to hand the model as context. */
  readonly reflectWindow: number;
  /** How many reflection receipts to retain; 0 keeps them all. */
  readonly reflectionsRetention: number;
}

const POLICY_BOUNDS: Pick<PolicyContext, 'topN' | 'maxBackoffTicks'> = {
  topN: { min: 3, max: 15 },
  maxBackoffTicks: 10,
};

/** Flatten a persisted tick record into the reflection prompt's digest (ADR-0042). */
export function toTickDigest(r: TickRecord): TickDigest {
  return {
    ranAt: r.ranAt,
    ok: r.ok,
    durationMs: r.durationMs,
    extracted: r.extracted,
    storiesUpserted: r.storiesUpserted,
    signalsObserved: r.signalsObserved,
    skipped: [...r.skipped, ...r.signalsSkipped],
    failed: [...r.failed, ...r.signalsFailed],
    error: r.error,
  };
}

/**
 * Reason over the trailing window of ticks as a group, screen the model's
 * proposed corrective actions through the deterministic policy guard, apply
 * what survives, and persist a receipt (ADR-0042/0053).
 *
 * Cadence is derived from the durable count of persisted `tick_reports` rows,
 * not an in-memory counter (ADR-0042 audit fix (b)) — an in-memory `tickCount`
 * resets every deploy, so a process that restarts often (the common case in
 * prod) could go long stretches — or forever — without ever reflecting.
 *
 * The receipt is persisted whenever the model said anything worth keeping —
 * non-empty advisory text OR at least one accepted action (audit fix (a)) —
 * not only when the advisory text is non-empty. A reflection that proposes
 * actions but writes no prose used to apply the actions with no receipt, so
 * the public /api/reflection feed showed nothing despite the loop having
 * changed behavior.
 */
export async function maybeReflect(deps: ReflectionDeps): Promise<void> {
  if (deps.reflectEveryTicks <= 0) return;
  const count = await deps.tickReportRepo.count();
  if (count === 0 || count % deps.reflectEveryTicks !== 0) return;

  const recent = await deps.tickReportRepo.recent(deps.reflectWindow);
  const reflection = await deps.reflect({ ticks: recent.map(toTickDigest) });
  const accepted = deps.screen(reflection.actions, {
    validSources: deps.validSources,
    ...POLICY_BOUNDS,
  });

  for (const b of accepted.backoffs) {
    deps.backoff.force(b.source, deps.nextTickIndex(), b.ticks);
    deps.log.info('reflect.backoff_forced', { source: b.source, ticks: b.ticks, reason: b.reason });
  }
  if (accepted.deepAnalysisTopN) {
    await deps.agentPolicyRepo.set(
      { deepAnalysisTopN: accepted.deepAnalysisTopN.value, reason: accepted.deepAnalysisTopN.reason },
      deps.now(),
    );
    deps.log.info('reflect.deep_analysis_top_n', {
      value: accepted.deepAnalysisTopN.value,
      reason: accepted.deepAnalysisTopN.reason,
    });
  }
  for (const r of accepted.rejected) {
    deps.log.warn('reflect.action_rejected', { why: r.why, action: r.action });
  }

  const text = reflection.advisory.trim();
  const actionsApplied = actionsFor(accepted);
  if (text || actionsApplied.length > 0) {
    await deps.tickReflectionRepo.record({
      createdAt: deps.now(),
      ticksCovered: recent.length,
      text,
      actions: actionsApplied,
    });
    if (deps.reflectionsRetention > 0) {
      await deps.tickReflectionRepo.pruneToRecent(deps.reflectionsRetention);
    }
    deps.log.info('reflect.advisory_written', { ticksCovered: recent.length });
  }
}

/** One unit of the maintenance sequence — a name for logging plus the work itself. */
export interface MaintenanceStep {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/**
 * Run each maintenance step (retention prunes, then reflection) in isolation
 * (ADR-0054 audit fix): a failing step used to be one un-isolated `await` chain
 * in `main.ts`'s `maintain()`, so a single rejecting prune (e.g. a locked table)
 * short-circuited every step after it for that cycle — including reflection,
 * which then silently starved for as long as the fault persisted. Each step's
 * failure is caught, logged, and the sequence continues in order.
 */
export async function runMaintenanceSteps(
  steps: readonly MaintenanceStep[],
  log: Pick<Logger, 'error'>,
): Promise<void> {
  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      log.error('maintain.step_failed', { step: step.name, err });
    }
  }
}

/** The screened actions the loop actually applied, in the shape the receipt stores. */
function actionsFor(
  accepted: ReturnType<typeof screenReflectionActions>,
): StoredReflectionAction[] {
  return [
    ...accepted.backoffs.map((b) => ({
      type: 'backoff_source', reason: b.reason, source: b.source, ticks: b.ticks,
    })),
    ...(accepted.deepAnalysisTopN
      ? [{
          type:
            accepted.deepAnalysisTopN.value === null
              ? 'clear_deep_analysis_top_n'
              : 'set_deep_analysis_top_n',
          reason: accepted.deepAnalysisTopN.reason,
          ...(accepted.deepAnalysisTopN.value !== null
            ? { value: accepted.deepAnalysisTopN.value }
            : {}),
        }]
      : []),
  ];
}
