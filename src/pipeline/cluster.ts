import type { PipelineReasoner } from '../llm/llm-client.js';
import type { Cluster } from '../domain/types.js';
import { cosine } from '../embedding/cosine.js';
import { dedupText } from './embed.js';
import { extractEntities, sharedEntityStats } from './entities.js';
import { DEFAULT_CONFIRM_CONCURRENCY, mapWithConcurrency } from './concurrency.js';
import { nullLogger, type Logger } from '../log/logger.js';
import type { EmbeddedItem } from './types.js';

/** Entity-aware blocking (ADR-0036). Optional layer; absent ⇒ pure cosine. */
export interface EntityBlocking {
  /** Lower cosine bar a pair may clear if it shares >= minSharedEntities. */
  readonly relaxedThreshold: number;
  /** Shared-entity count that unlocks the relaxed threshold for a pair. */
  readonly minSharedEntities: number;
  /**
   * Tiered relaxation: an even lower bar for pairs sharing MANY entities.
   * Cross-outlet phrasings of one event (a Wikipedia sentence vs a GDACS alert
   * title vs a Guardian headline) often land at cosine 0.60–0.66 — below the
   * one-entity band — while sharing the place AND the figures ("venezuela" +
   * "3500"). Defaults: `relaxedThreshold - STRONG_BAND_DELTA` once a pair shares
   * `minSharedEntities + 1` entities. Precision holds because the band demands
   * more shared evidence exactly when it trusts the cosine less, and every pair
   * still passes the Reasoner confirm.
   */
  readonly strongRelaxedThreshold?: number;
  readonly strongMinSharedEntities?: number;
}

/** How far below `relaxedThreshold` the >=2-entity band sits by default. */
const STRONG_BAND_DELTA = 0.06;

/** Cosine of one candidate pair, for the confirm-cap ranking. */
function simOf(items: readonly EmbeddedItem[], [i, j]: [number, number]): number {
  return cosine((items[i] as EmbeddedItem).vector, (items[j] as EmbeddedItem).vector);
}

export interface ClusterOptions {
  /** Cosine similarity above which two items become a candidate pair (ADR-0007). */
  readonly candidateThreshold: number;
  /** Optional entity-aware threshold relaxation (ADR-0036); omit to disable. */
  readonly entityBlocking?: EntityBlocking;
  /** Max concurrent confirm calls; defaults to DEFAULT_CONFIRM_CONCURRENCY. */
  readonly confirmConcurrency?: number;
  /** Hard cap on confirm calls per tick; defaults to MAX_CONFIRM_PAIRS. */
  readonly maxConfirmPairs?: number;
  /** Structured-log sink (src/log/logger.ts); absent ⇒ nullLogger (tests). */
  readonly log?: Logger;
}

/**
 * Bounds a tick's LLM confirm spend (ADR-0054): a big-event tick with ~25
 * same-event items would otherwise propose ~300 pairs. When over the cap the
 * most-similar pairs are kept — the likeliest true merges — and the truncation
 * is logged, never silent.
 */
const MAX_CONFIRM_PAIRS = 96;

/**
 * The blocking step (ADR-0007): cheaply find candidate same-Story pairs by
 * embedding proximity. Returns `[i, j]` index pairs (i < j) whose cosine clears
 * the threshold — the cheap filter that decides which pairs are worth a Reasoner
 * call. When `entityBlocking` is supplied (ADR-0036), a pair that shares enough
 * named entities only needs to clear the lower `relaxedThreshold`. Pure and
 * separately testable from the merge/connectivity step.
 */
export function candidatePairs(
  items: readonly EmbeddedItem[],
  threshold: number,
  entityBlocking?: EntityBlocking,
): Array<[number, number]> {
  // Extract entities once per item only when the layer is on (ADR-0036).
  const entitySets = entityBlocking
    ? items.map((it) => extractEntities(dedupText(it.item)))
    : null;

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i] as EmbeddedItem;
      const b = items[j] as EmbeddedItem;
      let bar = threshold;
      if (entitySets && entityBlocking) {
        const shared = sharedEntityStats(
          entitySets[i] as Set<string>,
          entitySets[j] as Set<string>,
        );
        const strongMin =
          entityBlocking.strongMinSharedEntities ?? entityBlocking.minSharedEntities + 1;
        const strongBar =
          entityBlocking.strongRelaxedThreshold ??
          Math.max(0, entityBlocking.relaxedThreshold - STRONG_BAND_DELTA);
        // Numbers alone never unlock a band: two different quakes share "7.1";
        // a shared non-numeric anchor (place/name) is required (ADR-0054).
        if (shared.nonNumeric >= 1) {
          if (shared.total >= strongMin) bar = strongBar;
          else if (shared.total >= entityBlocking.minSharedEntities) bar = entityBlocking.relaxedThreshold;
        }
      }
      if (cosine(a.vector, b.vector) >= bar) pairs.push([i, j]);
    }
  }
  return pairs;
}

/**
 * Cluster stage (ADR-0007). Two distinct concerns, now separated: the blocking
 * step (`candidatePairs`) proposes pairs cheaply; the Reasoner confirms each;
 * confirmed pairs are merged by a union-find (with path compression), so a chain
 * A~B~C forms one Cluster. Topic is taken from the earliest member.
 */
export async function cluster(
  items: readonly EmbeddedItem[],
  llm: PipelineReasoner,
  opts: ClusterOptions,
): Promise<Cluster[]> {
  const log = opts.log ?? nullLogger;
  const parent = items.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root] as number;
    // Path compression: point every node on the path straight at the root.
    let node = x;
    while (parent[node] !== root) {
      const next = parent[node] as number;
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  // Confirm the candidate pairs concurrently (each is an independent LLM call),
  // then apply the confirmed merges deterministically in pair order so the
  // union-find result is identical to the old serial loop (ADR — tick throughput).
  let pairs = candidatePairs(items, opts.candidateThreshold, opts.entityBlocking);
  const cap = opts.maxConfirmPairs ?? MAX_CONFIRM_PAIRS;
  if (pairs.length > cap) {
    // Keep the most-similar pairs (likeliest true merges); log what was dropped.
    const bySim = [...pairs].sort((p, q) => simOf(items, q) - simOf(items, p)).slice(0, cap);
    log.info('cluster.pair_cap', { confirming: cap, candidates: pairs.length });
    // Restore deterministic scan order so union-find behavior stays stable.
    pairs = bySim.sort(([ai, aj], [bi, bj]) => ai - bi || aj - bj);
  }
  const confirmed = await mapWithConcurrency(
    pairs,
    opts.confirmConcurrency ?? DEFAULT_CONFIRM_CONCURRENCY,
    ([i, j]) => {
      const a = items[i] as EmbeddedItem;
      const b = items[j] as EmbeddedItem;
      return llm.confirmSameStory(
        { title: a.item.title, text: a.item.text },
        { title: b.item.title, text: b.item.text },
      );
    },
  );
  pairs.forEach(([i, j], k) => {
    if (confirmed[k]) union(i, j);
  });

  // Confirm-veto observability: cheap precision evidence for the blocking bands
  // (how often the Reasoner rejects what the cosine/entity layer proposed).
  if (pairs.length > 0) {
    const accepted = confirmed.filter(Boolean).length;
    log.info('cluster.confirm.veto', { confirmed: accepted, vetoed: pairs.length - accepted });
  }

  // Group by root, preserving first-occurrence order.
  const groups = new Map<number, EmbeddedItem[]>();
  items.forEach((item, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(item);
    else groups.set(root, [item]);
  });

  return [...groups.values()].map((members) => {
    const lead = members[0] as EmbeddedItem;
    return {
      items: members.map((m) => m.item),
      topic: lead.topic,
    };
  });
}
