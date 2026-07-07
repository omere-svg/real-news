import { XMLParser } from 'fast-xml-parser';
import { xmlText as text, asArray } from './xml.js';
import { decodeEntities, stripHtml, collapseWhitespace as collapse } from '../text/clean.js';

/**
 * Shared RSS/Atom-RDF parsing for the media + thematic Source adapters
 * (ADR-0021). One place owns the two feed shapes — RSS 2.0 (`rss.channel.item`)
 * and RDF/RSS-1.0 (`rdf:RDF.item`, e.g. Nature) — so each adapter only maps the
 * normalized item to its Topic, never re-parses XML. `fast-xml-parser`
 * does not expand external/DTD entities, so this stays XXE-safe (ADR-0023).
 */
export interface RssItem {
  readonly title: string;
  readonly link: string | null;
  /** Plain-text summary: HTML stripped, whitespace collapsed. */
  readonly description: string | null;
  /** Publication time in epoch ms, or null if absent/unparseable. */
  readonly publishedAt: number | null;
  readonly categories: string[];
}

// processEntities:false: do NOT let the parser expand entities. This both avoids
// its billion-laughs guard tripping on large legit feeds (Guardian has >1000
// `&amp;`/numeric refs) and keeps us XXE-safe (ADR-0023); we decode the standard
// HTML entities ourselves below.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
});

// Entity decoding, HTML strip, and whitespace collapse are the shared canonical
// helpers (ADR-0051) — previously rss.ts had its own decoder that handled fewer
// named entities than the pipeline's, so the same entity rendered two ways.

/** Parse a feed (RSS 2.0 or RDF/1.0) into normalized items. Never throws. */
export function parseRssItems(xml: string): RssItem[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  const channel = (parsed.rss as { channel?: { item?: unknown } } | undefined)?.channel;
  const rdf = parsed['rdf:RDF'] as { item?: unknown } | undefined;
  const rawItems = asArray<Record<string, unknown>>(
    (channel?.item ?? rdf?.item) as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );

  return rawItems
    .map(toRssItem)
    .filter((i): i is RssItem => i !== null);
}

function toRssItem(node: Record<string, unknown>): RssItem | null {
  const title = decodeEntities(collapse(text(node.title) ?? ''));
  if (!title) return null;

  const rawLink = text(node.link) ?? (typeof node['@_rdf:about'] === 'string' ? node['@_rdf:about'] : null);
  const link = rawLink ? decodeEntities(rawLink) : null;

  const body = text(node.description) ?? text(node['content:encoded']);
  const description = body ? decodeEntities(collapse(stripHtml(body))) || null : null;

  const dateStr = text(node.pubDate) ?? text(node['dc:date']);
  const ts = dateStr ? Date.parse(dateStr) : Number.NaN;

  const categories = asArray(node.category)
    .map((c) => text(c))
    .filter((c): c is string => c !== null && c.length > 0)
    .map(decodeEntities);

  return {
    title,
    link,
    description,
    publishedAt: Number.isNaN(ts) ? null : ts,
    categories,
  };
}
