import type { LLMClient } from '../llm/llm-client.js';
import type { RawItem } from '../domain/types.js';
import type { ClassifiedItem } from './types.js';

/**
 * Classify stage (ADR-0009). Metadata-first: a Source's own Topic is
 * authoritative. Only when it is missing do we spend a Reasoner call.
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
  const { topic } = item.metadata;

  if (topic !== undefined) {
    return { item, topic };
  }

  const guess = await llm.classify({ title: item.title, text: item.text });
  return { item, topic: guess.topic };
}
