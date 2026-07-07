import { representativeOf, storyIdOf } from '../domain/cluster.js';
import { cosine } from '../embedding/cosine.js';
import { DEFAULT_CONFIRM_CONCURRENCY, mapWithConcurrency } from './concurrency.js';
import type { Cluster, RawItem, RawItemRef, Topic } from '../domain/types.js';
import type { StoredVector, StoryRepo } from '../db/story-repo.js';
import type { RawItemRepo } from '../db/raw-item-repo.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { Clock } from '../scheduler/clock.js';
import type { EmbeddedItem } from './types.js';

const HOUR_MS = 3_600_000;

/**
 * Cross-tick identity resolution (ADR-0017). After within-tick clustering, each
 * Cluster is matched against recent stored Stories of the same Topic: the
 * closest stored embedding above the threshold is escalated to the Reasoner, and
 * on a confirmed match the Cluster adopts that Story's id and absorbs its prior
 * member Raw Items so it accretes corroboration across ticks. Otherwise it gets a
 * fresh deterministic id. The representative vector rides along for persistence.
 */
export interface IdentifiedCluster {
  /** The Story id this Cluster resolves to (existing match, or a fresh storyIdOf). */
  readonly id: string;
  readonly cluster: Cluster;
  /** The Cluster's representative embedding, stored after upsert for future ticks. */
  readonly vector: number[];
}

export interface ResolveDeps {
  readonly storyRepo: StoryRepo;
  readonly rawItemRepo: RawItemRepo;
  readonly llm: LLMClient;
  readonly clock: Clock;
}

export interface ResolveOptions {
  /** Cosine similarity above which a stored Story is a candidate match (ADR-0007). */
  readonly candidateThreshold: number;
  /** How far back to consider stored Stories for a match. */
  readonly recentWindowHours: number;
  /**
   * Match across ALL Topics rather than only the Cluster's own Topic (ADR-0038).
   * The same event is often classified inconsistently across sources (an
   * earthquake as Climate vs Geopolitics), so a same-Topic gate blocks the merge.
   * The LLM confirm + high threshold still guard against false merges. Off ⇒
   * legacy same-Topic behaviour.
   */
  readonly crossTopic?: boolean;
  /** Max concurrent confirm calls; defaults to DEFAULT_CONFIRM_CONCURRENCY. */
  readonly confirmConcurrency?: number;
}

/**
 * The closest stored vector above `threshold`, or null. Pure: the matching heart
 * of cross-tick dedup, separately testable from the DB/LLM orchestration.
 */
export function bestMatch(
  vector: readonly number[],
  candidates: readonly StoredVector[],
  threshold: number,
): string | null {
  let bestId: string | null = null;
  let best = -Infinity;
  for (const candidate of candidates) {
    const sim = cosine(vector, candidate.vector);
    if (sim > best) {
      best = sim;
      bestId = candidate.storyId;
    }
  }
  return best >= threshold ? bestId : null;
}

const refKey = (ref: RawItemRef): string => `${ref.source}:${ref.externalId}`;

export async function resolve(
  clusters: readonly Cluster[],
  embedded: readonly EmbeddedItem[],
  deps: ResolveDeps,
  opts: ResolveOptions,
): Promise<IdentifiedCluster[]> {
  const vectorByItem = new Map(embedded.map((e) => [refKey(e.item), e.vector]));
  const sinceMs = deps.clock.now() - opts.recentWindowHours * HOUR_MS;

  // Fetch recent stored vectors ONCE, not once per cluster (ADR-0049). The old
  // per-cluster fetch issued ~one identical large Turso read per cluster (~200/
  // tick) — the dominant cause of multi-minute ticks. Memoize by the query key:
  // a single fetch when crossTopic, else one per distinct Topic. The Promise is
  // stored synchronously before any await, so concurrent callers share one query.
  const candidatesByKey = new Map<string, Promise<StoredVector[]>>();
  const candidatesFor = (topic: Topic): Promise<StoredVector[]> => {
    const key = opts.crossTopic ? '' : topic;
    let p = candidatesByKey.get(key);
    if (!p) {
      p = deps.storyRepo.recentVectors({ ...(opts.crossTopic ? {} : { topic }), sinceMs });
      candidatesByKey.set(key, p);
    }
    return p;
  };

  // Resolve each Cluster independently and concurrently — this pass only READS
  // the store (writes happen later in the upsert loop), so bounded-parallel
  // matching is safe and keeps a tick's wall-time under the interval (ADR-0038).
  const resolved = await mapWithConcurrency(
    clusters,
    opts.confirmConcurrency ?? DEFAULT_CONFIRM_CONCURRENCY,
    async (cluster): Promise<IdentifiedCluster> => {
      const rep = representativeOf(cluster);
      const vector = vectorByItem.get(refKey(rep)) ?? [];

      const candidates = await candidatesFor(cluster.topic);
      const matchId = bestMatch(vector, candidates, opts.candidateThreshold);

      if (matchId) {
        const existing = await deps.storyRepo.get(matchId);
        const confirmed =
          existing !== null &&
          (await deps.llm.confirmSameStory(
            { title: rep.title, text: rep.text },
            { title: existing.title, text: null },
          ));
        if (existing && confirmed) {
          const priorItems = await loadItems(existing.memberRefs, deps.rawItemRepo);
          // Keep the accreting Story's own Topic so it doesn't flap tick-to-tick
          // when a later member was classified differently (ADR-0038).
          return {
            id: matchId,
            cluster: { topic: existing.topic, items: mergeItems(cluster.items, priorItems) },
            vector,
          };
        }
      }

      return { id: storyIdOf(cluster), cluster, vector };
    },
  );

  // Two distinct Clusters can resolve to the SAME Story id (both matched one
  // prior Story, or two fresh clusters share a representative). The upsert loop
  // writes by id, so without this the second write would clobber the first and
  // orphan the first's members. Fold same-id results into one (ADR-0038).
  return dedupeById(resolved);
}

/** Merge IdentifiedClusters that share a Story id: union their items, keep the first vector/topic. */
function dedupeById(resolved: readonly IdentifiedCluster[]): IdentifiedCluster[] {
  const byId = new Map<string, IdentifiedCluster>();
  for (const r of resolved) {
    const existing = byId.get(r.id);
    if (!existing) {
      byId.set(r.id, r);
      continue;
    }
    byId.set(r.id, {
      id: r.id,
      cluster: { topic: existing.cluster.topic, items: mergeItems(existing.cluster.items, r.cluster.items) },
      // Prefer a non-empty vector: if the first cluster had no embedding, take the
      // second's, so the merged story stays cross-tick-matchable (ADR-0051).
      vector: existing.vector.length ? existing.vector : r.vector,
    });
  }
  return [...byId.values()];
}

/** Load the persisted Raw Items behind a Story's member refs (skips any missing). */
async function loadItems(
  refs: readonly RawItemRef[],
  repo: RawItemRepo,
): Promise<RawItem[]> {
  const items = await Promise.all(refs.map((ref) => repo.get(ref)));
  return items.filter((i): i is RawItem => i !== null);
}

/** Union current items with prior ones, de-duplicating by (source, externalId). */
function mergeItems(
  current: readonly RawItem[],
  prior: readonly RawItem[],
): RawItem[] {
  const seen = new Set(current.map(refKey));
  return [...current, ...prior.filter((i) => !seen.has(refKey(i)))];
}
