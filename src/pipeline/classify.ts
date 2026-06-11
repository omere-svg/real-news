import type { LLMClient } from '../llm/llm-client.js';
import type { RawItem } from '../domain/types.js';
import type { ClassifiedItem } from './types.js';

/**
 * Classify stage (ADR-0009). Metadata-first: a Source's own Region/Topic is
 * authoritative. Only when a field is missing do we spend a Reasoner call —
 * and even then, present metadata fields win over the LLM's.
 */
export async function classify(
  items: readonly RawItem[],
  llm: LLMClient,
): Promise<ClassifiedItem[]> {
  return Promise.all(items.map((item) => classifyItem(item, llm)));
}

async function classifyItem(
  item: RawItem,
  llm: LLMClient,
): Promise<ClassifiedItem> {
  const { region, topic } = item.metadata;

  if (region !== undefined && topic !== undefined) {
    return { item, region, topic };
  }

  const guess = await llm.classify({ title: item.title, text: item.text });
  return {
    item,
    region: region ?? guess.region,
    topic: topic ?? guess.topic,
  };
}
