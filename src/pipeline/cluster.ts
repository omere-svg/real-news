import type { LLMClient } from '../llm/llm-client.js';
import type { Cluster } from '../domain/types.js';
import { cosine } from '../embedding/cosine.js';
import type { EmbeddedItem } from './types.js';

export interface ClusterOptions {
  /** Cosine similarity above which two items become a candidate pair (ADR-0007). */
  readonly candidateThreshold: number;
}

/**
 * The blocking step (ADR-0007): cheaply find candidate same-Story pairs by
 * embedding proximity. Returns `[i, j]` index pairs (i < j) whose cosine clears
 * the threshold — the cheap filter that decides which pairs are worth a Reasoner
 * call. Pure and separately testable from the merge/connectivity step.
 */
export function candidatePairs(
  items: readonly EmbeddedItem[],
  threshold: number,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i] as EmbeddedItem;
      const b = items[j] as EmbeddedItem;
      if (cosine(a.vector, b.vector) >= threshold) pairs.push([i, j]);
    }
  }
  return pairs;
}

/**
 * Cluster stage (ADR-0007). Two distinct concerns, now separated: the blocking
 * step (`candidatePairs`) proposes pairs cheaply; the Reasoner confirms each;
 * confirmed pairs are merged by a union-find (with path compression), so a chain
 * A~B~C forms one Cluster. Region/Topic are taken from the earliest member.
 */
export async function cluster(
  items: readonly EmbeddedItem[],
  llm: LLMClient,
  opts: ClusterOptions,
): Promise<Cluster[]> {
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

  for (const [i, j] of candidatePairs(items, opts.candidateThreshold)) {
    const a = items[i] as EmbeddedItem;
    const b = items[j] as EmbeddedItem;
    const same = await llm.confirmSameStory(
      { title: a.item.title, text: a.item.text },
      { title: b.item.title, text: b.item.text },
    );
    if (same) union(i, j);
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
      region: lead.region,
      topic: lead.topic,
    };
  });
}
