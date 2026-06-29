/**
 * Shared XML helpers for the feed adapters (ADR-0037 tidy). `rss.ts` (the generic
 * RSS/RDF parser) and `gdacs.ts` (its own namespaced parse) both need to coerce
 * `fast-xml-parser` nodes and normalize one-or-many children, so those two tiny
 * helpers live here once. Each adapter still owns its own `XMLParser` config —
 * those deliberately differ (attributes, entities) and are not shared.
 */

/** Coerce an XML node (string, number, or `{ '#text': ... }`) to a string, or null. */
export function xmlText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)['#text']);
  }
  return null;
}

/** Normalize a `T | T[] | null | undefined` XML child to an array. */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
