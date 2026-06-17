import { representativeOf, storyIdOf } from '../domain/cluster.js';
import { cosine } from '../embedding/cosine.js';
import type { Cluster, RawItem, RawItemRef } from '../domain/types.js';
import type { StoredVector, StoryRepo } from '../db/story-repo.js';
import type { RawItemRepo } from '../db/raw-item-repo.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { Clock } from '../scheduler/clock.js';
import type { EmbeddedItem } from './types.js';

const HOUR_MS = 3_600_000;

/**
 * Cross-tick identity resolution (ADR-0017). After within-tick clustering, each
 * Cluster is matched against recent stored Stories of the same Region/Topic: the
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

  const out: IdentifiedCluster[] = [];
  for (const cluster of clusters) {
    const rep = representativeOf(cluster);
    const vector = vectorByItem.get(refKey(rep)) ?? [];

    const candidates = await deps.storyRepo.recentVectors({
      region: cluster.region,
      topic: cluster.topic,
      sinceMs,
    });
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
        out.push({
          id: matchId,
          cluster: { ...cluster, items: mergeItems(cluster.items, priorItems) },
          vector,
        });
        continue;
      }
    }

    out.push({ id: storyIdOf(cluster), cluster, vector });
  }
  return out;
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
