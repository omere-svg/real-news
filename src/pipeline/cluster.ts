import type { LLMClient } from '../llm/llm-client.js';
import type { Cluster } from '../domain/types.js';
import type { EmbeddedItem } from './types.js';

export interface ClusterOptions {
  /** Cosine similarity above which two items become a candidate pair (ADR-0007). */
  readonly candidateThreshold: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Cluster stage (ADR-0007). Embedding blocking finds candidate pairs cheaply
 * (cosine ≥ threshold); the Reasoner confirms only those candidates before two
 * items are merged. Confirmed pairs are unioned, so a chain A~B~C forms one
 * Cluster. Region/Topic are taken from the earliest member.
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
    return root;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i] as EmbeddedItem;
      const b = items[j] as EmbeddedItem;
      if (cosine(a.vector, b.vector) < opts.candidateThreshold) continue;
      const same = await llm.confirmSameStory(
        { title: a.item.title, text: a.item.text },
        { title: b.item.title, text: b.item.text },
      );
      if (same) union(i, j);
    }
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
