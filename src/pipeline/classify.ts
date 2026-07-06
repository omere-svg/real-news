import type { LLMClient } from '../llm/llm-client.js';
import type { RawItem } from '../domain/types.js';
import type { ClassifiedItem } from './types.js';
import { mapWithConcurrency, DEFAULT_CONFIRM_CONCURRENCY } from './concurrency.js';

/**
 * Classify stage (ADR-0009). Metadata-first: a Source's own Topic is
 * authoritative. Only when it is missing do we spend a Reasoner call — and those
 * calls run with bounded concurrency (ADR-0047) so a tick with many
 * unclassified items doesn't fire hundreds of requests at the model at once.
 */
export async function classify(
  items: readonly RawItem[],
  llm: LLMClient,
  concurrency: number = DEFAULT_CONFIRM_CONCURRENCY,
): Promise<ClassifiedItem[]> {
  return mapWithConcurrency(items, concurrency, (item) => classifyItem(item, llm));
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
