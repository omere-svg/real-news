import type { ReflectionAction } from '../llm/llm-client.js';
import type { SourceId } from '../domain/types.js';

/**
 * The reflection policy guard (ADR-0053): the deterministic half of the
 * reflection→action loop. The Reflector LLM *proposes* corrective actions; this
 * pure screen *disposes* — whitelisted action types only, sources validated
 * against what the pipeline actually runs, every magnitude clamped. The model
 * can never push a parameter out of bounds or invent a new capability.
 */

export interface PolicyContext {
  /** Source ids the pipeline actually runs — anything else is rejected. */
  readonly validSources: readonly string[];
  /** Bounds for the deep-analysis budget override. */
  readonly topN: { readonly min: number; readonly max: number };
  /** Bounds for the confirm-concurrency override (ADR-0061). */
  readonly confirmConcurrency: { readonly min: number; readonly max: number };
  /** Bounds for the candidate-threshold override (ADR-0061). */
  readonly candidateThreshold: { readonly min: number; readonly max: number };
  /** Longest backoff a reflection may impose, in ticks. */
  readonly maxBackoffTicks: number;
}

export interface AcceptedBackoff {
  readonly source: SourceId;
  readonly ticks: number;
  readonly reason: string;
}

/** What survived the screen — the only thing the loop is allowed to apply.
 * `deepAnalysisTopN.value === null` means "clear the override" (back to config).
 * The two numeric knobs are set-only from the model; they revert to config via
 * the deterministic auto-revert (ADR-0061), never a model-issued clear. */
export interface AcceptedActions {
  readonly backoffs: readonly AcceptedBackoff[];
  readonly deepAnalysisTopN: { readonly value: number | null; readonly reason: string } | null;
  readonly confirmConcurrency: { readonly value: number; readonly reason: string } | null;
  readonly candidateThreshold: { readonly value: number; readonly reason: string } | null;
  readonly rejected: readonly { readonly action: ReflectionAction; readonly why: string }[];
}

const clampInt = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(v)));

const clampFloat = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export function screenReflectionActions(
  actions: readonly ReflectionAction[],
  ctx: PolicyContext,
): AcceptedActions {
  const backoffs: AcceptedBackoff[] = [];
  const rejected: { action: ReflectionAction; why: string }[] = [];
  let deepAnalysisTopN: { value: number | null; reason: string } | null = null;
  let confirmConcurrency: { value: number; reason: string } | null = null;
  let candidateThreshold: { value: number; reason: string } | null = null;

  for (const action of actions) {
    if (action.type === 'backoff_source') {
      if (!ctx.validSources.includes(action.source)) {
        rejected.push({ action, why: `unknown source "${action.source}"` });
        continue;
      }
      backoffs.push({
        source: action.source as SourceId,
        ticks: clampInt(action.ticks, 1, ctx.maxBackoffTicks),
        reason: action.reason,
      });
    } else if (action.type === 'clear_deep_analysis_top_n') {
      // Back to the configured default — the override must be revocable.
      deepAnalysisTopN = { value: null, reason: action.reason };
    } else if (action.type === 'set_deep_analysis_top_n') {
      // Last proposal wins, clamped into bounds.
      deepAnalysisTopN = {
        value: clampInt(action.value, ctx.topN.min, ctx.topN.max),
        reason: action.reason,
      };
    } else if (action.type === 'set_confirm_concurrency') {
      // A non-finite / absurd value can't push throughput out of bounds.
      if (!Number.isFinite(action.value)) {
        rejected.push({ action, why: 'non-finite confirm_concurrency' });
        continue;
      }
      confirmConcurrency = {
        value: clampInt(action.value, ctx.confirmConcurrency.min, ctx.confirmConcurrency.max),
        reason: action.reason,
      };
    } else {
      // set_candidate_threshold — a real in [min, max]; guarded against non-finite.
      if (!Number.isFinite(action.value)) {
        rejected.push({ action, why: 'non-finite candidate_threshold' });
        continue;
      }
      candidateThreshold = {
        value: clampFloat(action.value, ctx.candidateThreshold.min, ctx.candidateThreshold.max),
        reason: action.reason,
      };
    }
  }

  return { backoffs, deepAnalysisTopN, confirmConcurrency, candidateThreshold, rejected };
}
