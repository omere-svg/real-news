import type { Embedder } from '../embedding/embedder.js';
import type { ClassifiedItem, EmbeddedItem } from './types.js';

/**
 * Embed stage (ADR-0007). Vectorizes item titles in one batch for the dedup
 * blocking step. Order is preserved so each vector lines up with its item.
 */
export async function embed(
  items: readonly ClassifiedItem[],
  embedder: Embedder,
): Promise<EmbeddedItem[]> {
  const vectors = await embedder.embed(items.map((c) => c.item.title));
  return items.map((c, i) => ({ ...c, vector: vectors[i] ?? [] }));
}
