import { computeBaseScore } from '../scoring/compute-base-score.js';
import {
  EMPTY_SIGNAL_CONTEXT,
  signalAdjustment,
  type SignalContext,
} from '../scoring/signal-context.js';
import { representativeOf } from '../domain/cluster.js';
import type { Clock } from '../scheduler/clock.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { Cluster, Signals, SourceId } from '../domain/types.js';
import type { ScoredCluster } from './types.js';

const HOUR_MS = 3_600_000;
const DEFAULT_SOURCE_WEIGHT = 0.5;

export interface ScoreContext {
  readonly clock: Clock;
  readonly recencyHalfLifeHours: number;
  readonly maxEditorialAdjustment: number;
  readonly sourceWeights: Partial<Record<SourceId, number>>;
  /** Partition-scoped numeric Signal context for this tick (ADR-0025). */
  readonly signalContext?: SignalContext;
  /** Max absolute Signal nudge; 0/absent leaves base scoring untouched. */
  readonly maxSignalAdjustment?: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Assemble the verifiable Signals for a Cluster (ADR-0008). Pure and
 * inspectable: corroboration is the distinct-source count, popularity/tone are
 * the peak across members, age is taken from the freshest member.
 */
export function assembleSignals(
  cluster: Cluster,
  now: number,
  sourceWeights: Partial<Record<SourceId, number>>,
): Signals {
  const sources = new Set(cluster.items.map((i) => i.source));

  const points = Math.max(0, ...cluster.items.map((i) => i.metadata.points ?? 0));
  const mentions = Math.max(
    0,
    ...cluster.items.map((i) => i.metadata.mentions ?? 0),
  );
  const tone = cluster.items
    .map((i) => i.metadata.tone ?? 0)
    .reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const sourceWeight = Math.max(
    0,
    ...[...sources].map((s) => sourceWeights[s] ?? DEFAULT_SOURCE_WEIGHT),
  );
  const publishedTimes = cluster.items
    .map((i) => i.publishedAt)
    .filter((t): t is number => t !== null);
  const newest = publishedTimes.length > 0 ? Math.max(...publishedTimes) : now;
  const ageHours = Math.max(0, (now - newest) / HOUR_MS);

  return {
    points,
    mentions,
    tone,
    sourceWeight,
    ageHours,
    corroboration: sources.size,
  };
}

/**
 * Score stage (ADR-0008). The deterministic base from verifiable Signals, a
 * bounded editorial adjustment from the Reasoner, and a bounded numeric-Signal
 * nudge from the partition's attention/macro context (ADR-0025) — neither the
 * LLM nor the signals can dominate. Final score is clamped to [0, 10].
 */
export async function score(
  clusters: readonly Cluster[],
  llm: LLMClient,
  ctx: ScoreContext,
): Promise<ScoredCluster[]> {
  const now = ctx.clock.now();
  return Promise.all(
    clusters.map(async (cluster) => {
      const signals = assembleSignals(cluster, now, ctx.sourceWeights);
      const base = computeBaseScore(signals, {
        recencyHalfLifeHours: ctx.recencyHalfLifeHours,
      });

      const lead = representativeOf(cluster);
      const rawAdjustment = await llm.adjustSignificance({
        title: lead.title,
        text: lead.text,
        baseScore: base,
      });
      const adjustment = clamp(
        rawAdjustment,
        -ctx.maxEditorialAdjustment,
        ctx.maxEditorialAdjustment,
      );

      const signalNudge = signalAdjustment(
        cluster.topic,
        ctx.signalContext ?? EMPTY_SIGNAL_CONTEXT,
        ctx.maxSignalAdjustment ?? 0,
      );

      return {
        cluster,
        significance: clamp(base + adjustment + signalNudge, 0, 10),
      };
    }),
  );
}
