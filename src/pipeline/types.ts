import type { Cluster, RawItem, ScoreBreakdown, Topic } from '../domain/types.js';

/** A RawItem after the classify stage (ADR-0009). */
export interface ClassifiedItem {
  readonly item: RawItem;
  readonly topic: Topic;
}

/** A ClassifiedItem after the embed stage (ADR-0007). */
export interface EmbeddedItem extends ClassifiedItem {
  readonly vector: number[];
}

/**
 * A Cluster after the score stage (ADR-0008). Carries the resolved Story `id`
 * and representative `vector` threaded from the resolve stage (ADR-0063): the
 * downstream upsert reads `analyzed[i].id` directly instead of re-zipping the
 * score/analyze/resolve arrays by positional index — a typed join that removes
 * the latent "wrong analysis paired to wrong story" corruption seam.
 */
export interface ScoredCluster {
  /** The resolved Story id this Cluster upserts under (from resolve). */
  readonly id: string;
  /** The Cluster's representative embedding, persisted after upsert (from resolve). */
  readonly vector: number[];
  readonly cluster: Cluster;
  readonly significance: number;
  /** The inspectable decomposition of `significance` (ADR-0032). */
  readonly breakdown: ScoreBreakdown;
}

/** A ScoredCluster after the analyze stage (ADR-0006). */
export interface AnalyzedCluster extends ScoredCluster {
  /** Factual "what happened" recap; null unless this Cluster was deep-analyzed. */
  readonly summary: string | null;
  readonly whyItMatters: string | null;
  /** English display headline from the deep tier; null unless this Cluster was deep-analyzed (Task 20). */
  readonly displayTitle: string | null;
}

export type { Cluster, RawItem, Topic };
