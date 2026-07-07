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
  /** Longest backoff a reflection may impose, in ticks. */
  readonly maxBackoffTicks: number;
}

export interface AcceptedBackoff {
  readonly source: SourceId;
  readonly ticks: number;
  readonly reason: string;
}

/** What survived the screen — the only thing the loop is allowed to apply. */
export interface AcceptedActions {
  readonly backoffs: readonly AcceptedBackoff[];
  readonly deepAnalysisTopN: { readonly value: number; readonly reason: string } | null;
  readonly rejected: readonly { readonly action: ReflectionAction; readonly why: string }[];
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(v)));

export function screenReflectionActions(
  actions: readonly ReflectionAction[],
  ctx: PolicyContext,
): AcceptedActions {
  const backoffs: AcceptedBackoff[] = [];
  const rejected: { action: ReflectionAction; why: string }[] = [];
  let deepAnalysisTopN: { value: number; reason: string } | null = null;

  for (const action of actions) {
    if (action.type === 'backoff_source') {
      if (!ctx.validSources.includes(action.source)) {
        rejected.push({ action, why: `unknown source "${action.source}"` });
        continue;
      }
      backoffs.push({
        source: action.source as SourceId,
        ticks: clamp(action.ticks, 1, ctx.maxBackoffTicks),
        reason: action.reason,
      });
    } else {
      // set_deep_analysis_top_n — last proposal wins, clamped into bounds.
      deepAnalysisTopN = {
        value: clamp(action.value, ctx.topN.min, ctx.topN.max),
        reason: action.reason,
      };
    }
  }

  return { backoffs, deepAnalysisTopN, rejected };
}
