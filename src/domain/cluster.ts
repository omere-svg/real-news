import type { Cluster, RawItem } from './types.js';

/**
 * The projection of a Cluster onto the single Raw Item that represents it.
 * One place owns this policy so the score, analyze, and upsert stages all agree
 * on "which item speaks for this Cluster" and on the Story's stable identity
 * (re-tick idempotency, ADR-0005). Deterministic: the lowest (source,
 * externalId), independent of extraction order.
 */
export function representativeOf(cluster: Cluster): RawItem {
  const [rep] = [...cluster.items].sort((a, b) =>
    a.source === b.source
      ? a.externalId.localeCompare(b.externalId)
      : a.source.localeCompare(b.source),
  );
  if (!rep) throw new Error('representativeOf: empty cluster');
  return rep;
}

/** The deterministic Story id for a Cluster — stable across ticks. */
export function storyIdOf(cluster: Cluster): string {
  const rep = representativeOf(cluster);
  return `${rep.source}:${rep.externalId}`;
}
