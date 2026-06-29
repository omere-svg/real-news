import type { Embedder } from '../embedding/embedder.js';
import type { RawItem } from '../domain/types.js';
import type { ClassifiedItem, EmbeddedItem } from './types.js';

/** How much of the body lead to fold into the dedup text (ADR-0035). */
const DEDUP_LEAD_CHARS = 320;

/**
 * The text vectorized for dedup (ADR-0035): the title plus a markup-stripped lead
 * of the body. Two articles about the same event — even with different headlines —
 * share event specifics (place, figures, actors) in the body, so they land close
 * in vector space and become candidate pairs. Title-only items embed just the
 * title, exactly as before.
 */
export function dedupText(item: Pick<RawItem, 'title' | 'text'>): string {
  const title = item.title.trim();
  const body = (item.text ?? '')
    .replace(/<[^>]+>/g, ' ') // strip any markup
    .replace(/\s+/g, ' ')
    .trim();
  if (!body) return title;
  return `${title}. ${body.slice(0, DEDUP_LEAD_CHARS)}`;
}

/**
 * Embed stage (ADR-0007/0035). Vectorizes each item's title + body lead in one
 * batch for the dedup blocking step. Order is preserved so each vector lines up
 * with its item.
 */
export async function embed(
  items: readonly ClassifiedItem[],
  embedder: Embedder,
): Promise<EmbeddedItem[]> {
  const vectors = await embedder.embed(items.map((c) => dedupText(c.item)));
  return items.map((c, i) => ({ ...c, vector: vectors[i] ?? [] }));
}
