import type { Cluster, RawItem, RawItemRef } from './types.js';

/**
 * The single owner of the "which member speaks for this Cluster" tie-break:
 * the lowest (source, externalId), independent of extraction order. Both the
 * live pipeline and the backfill delegate here so they never pick a different
 * representative for the same story (ADR-0005/0051).
 */
export function representativeRefOf<T extends RawItemRef>(refs: readonly T[]): T {
  const [rep] = [...refs].sort((a, b) =>
    a.source === b.source
      ? a.externalId.localeCompare(b.externalId)
      : a.source.localeCompare(b.source),
  );
  if (!rep) throw new Error('representativeRefOf: empty ref list');
  return rep;
}

/**
 * The projection of a Cluster onto the single Raw Item that represents it.
 * One place owns this policy so the score, analyze, and upsert stages all agree
 * on the Story's stable identity (re-tick idempotency, ADR-0005).
 */
export function representativeOf(cluster: Cluster): RawItem {
  return representativeRefOf(cluster.items);
}

/** The deterministic Story id for a Cluster — stable across ticks. */
export function storyIdOf(cluster: Cluster): string {
  const rep = representativeOf(cluster);
  return `${rep.source}:${rep.externalId}`;
}
