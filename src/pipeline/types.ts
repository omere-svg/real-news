import type { Cluster, RawItem, Region, Topic } from '../domain/types.js';

/** A RawItem after the classify stage (ADR-0009). */
export interface ClassifiedItem {
  readonly item: RawItem;
  readonly region: Region;
  readonly topic: Topic;
}

/** A ClassifiedItem after the embed stage (ADR-0007). */
export interface EmbeddedItem extends ClassifiedItem {
  readonly vector: number[];
}

/** A Cluster after the score stage (ADR-0008). */
export interface ScoredCluster {
  readonly cluster: Cluster;
  readonly significance: number;
}

/** A ScoredCluster after the analyze stage (ADR-0006). */
export interface AnalyzedCluster extends ScoredCluster {
  readonly whyItMatters: string | null;
}

export type { Cluster, RawItem, Region, Topic };
