import { baseScoreBreakdown } from '../scoring/compute-base-score.js';
import {
  EMPTY_SIGNAL_CONTEXT,
  entityAdjustment,
  signalAdjustment,
  type SignalContext,
} from '../scoring/signal-context.js';
import { extractEntities } from './entities.js';
import { dedupText } from './embed.js';
import { mapWithConcurrency, DEFAULT_CONFIRM_CONCURRENCY } from './concurrency.js';
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
  readonly sourceWeights: Partial<Record<SourceId, number>>;
  /** Partition-scoped numeric Signal context for this tick (ADR-0025). */
  readonly signalContext?: SignalContext;
  /** Max absolute Signal nudge; 0/absent leaves base scoring untouched. */
  readonly maxSignalAdjustment?: number;
  /** Max concurrent impact calls (ADR-0047); absent ⇒ default bound. */
  readonly concurrency?: number;
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
 * Score stage (ADR-0034). An impact-first base — real-world impact (read by the
 * Reasoner's cheap tier), corroboration and source authority combined so any
 * strong axis lifts the score, with social attention as a bounded add-on — plus a
 * bounded numeric-Signal nudge from the partition context (ADR-0025). Clamped to
 * [0, 10].
 */
export async function score(
  clusters: readonly Cluster[],
  llm: LLMClient,
  ctx: ScoreContext,
): Promise<ScoredCluster[]> {
  const now = ctx.clock.now();
  // One impact call per cluster: bound the in-flight count so a large tick can't
  // fan out hundreds of model requests at once (ADR-0047).
  return mapWithConcurrency(
    clusters,
    ctx.concurrency ?? DEFAULT_CONFIRM_CONCURRENCY,
    async (cluster) => {
      const signals = assembleSignals(cluster, now, ctx.sourceWeights);

      const lead = representativeOf(cluster);
      const impact = await llm.assessImpact({ title: lead.title, text: lead.text });

      const { base, recencyFactor, components } = baseScoreBreakdown(signals, impact, {
        recencyHalfLifeHours: ctx.recencyHalfLifeHours,
      });

      // The Signal nudge is the stronger of the Topic-level attention and the
      // entity-level attention on THIS story's named entities (ADR-0025/0043) —
      // taking the max keeps it within the single maxSignalAdjustment ceiling.
      const signalCtx = ctx.signalContext ?? EMPTY_SIGNAL_CONTEXT;
      const max = ctx.maxSignalAdjustment ?? 0;
      const topicNudge = signalAdjustment(cluster.topic, signalCtx, max);
      const entityNudge = entityAdjustment(
        extractEntities(dedupText({ title: lead.title, text: lead.text })),
        signalCtx,
        max,
      );
      const signalNudge = Math.max(topicNudge, entityNudge);

      return {
        cluster,
        significance: clamp(base + signalNudge, 0, 10),
        // The inspectable "why this score" snapshot (ADR-0032/0034).
        breakdown: { base, recencyFactor, components, impact, signalNudge, signals },
      };
    },
  );
}
