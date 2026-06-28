import { parseRssItems } from './rss.js';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem, SourceId, StorySourceId, Topic } from '../domain/types.js';

export interface RssSourceDeps {
  readonly id: StorySourceId;
  /** The public RSS/RDF feed URL (ADR-0021 — summaries + link only, no body). */
  readonly feedUrl: string;
  /** Topic if the feed maps to one (e.g. NBER⇒Business, Times of Israel⇒Israel); omit to let the Reasoner classify. */
  readonly topic?: Topic;
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * Generic public-RSS Source adapter (ADR-0021). One deep adapter behind the
 * Source seam serves every keyless RSS feed (Guardian, Times of Israel, NBER,
 * Nature) — they differ only by feed URL and asserted Topic. Ingests headline +
 * summary + link only (never full body); the stable item link is the dedup key.
 * Skips items without a link.
 */
export class RssSource implements SourceAdapter {
  readonly id: SourceId;

  constructor(private readonly deps: RssSourceDeps) {
    this.id = deps.id;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const xml = await this.deps.fetchJson(this.deps.feedUrl, { as: 'text' });
      return typeof xml === 'string' && /<(rss|rdf:RDF|channel|item)\b/.test(xml);
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const xml = await this.deps.fetchJson(this.deps.feedUrl, { as: 'text' });
    const items = parseRssItems(String(xml)).slice(0, this.deps.maxItems);

    return items
      .filter((item) => item.link !== null)
      .map((item) => ({
        source: this.deps.id,
        externalId: item.link as string,
        title: item.title,
        url: item.link,
        text: item.description,
        publishedAt: item.publishedAt,
        metadata: {
          ...(this.deps.topic ? { topic: this.deps.topic } : {}),
        },
      }));
  }
}
