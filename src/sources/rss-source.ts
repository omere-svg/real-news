import { parseRssItems } from './rss.js';
import { canonicalizeUrl } from './url.js';
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
 * NBER working-paper titles carry a trailing authors suffix in the feed itself
 * ("Growth and Jobs -- by Daron Acemoglu, David Autor" — observed live). Strip
 * it at ingestion so headlines read as headlines; authors remain reachable via
 * the paper link. Matches "--", em- and en-dash separators; requires whitespace
 * after "by" so titles like "Growth by Design" are untouched.
 */
// The author list always starts with a capitalized name — "— by 2050" or
// "— by design" in a legitimate title must survive.
const NBER_AUTHORS_SUFFIX = /\s+(?:--|—|–)\s*by\s+[A-ZÀ-Þ].+$/;

/**
 * A live-blog URL (path contains a "/live/" segment, e.g. Guardian's
 * /australia-news/live/2026/...). Live-blog feed entries bundle unrelated
 * blurbs — the observed item's title named one story while its description
 * summarized another — so no single title/summary pair describes one event.
 */
function isLiveBlogUrl(url: string): boolean {
  try {
    return new URL(url).pathname.split('/').includes('live');
  } catch {
    return false;
  }
}

/**
 * Generic public-RSS Source adapter (ADR-0021). One deep adapter behind the
 * Source seam serves every keyless RSS feed (Guardian, Times of Israel, NBER,
 * Nature) — they differ only by feed URL and asserted Topic. Ingests headline +
 * summary + link only (never full body); the stable item link is the dedup key.
 * Skips items without a link, and live-blog items (see isLiveBlogUrl): their
 * title/summary describe different blurbs and mutate under a stable link, which
 * would poison dedup and mislead readers; the discrete events they cover arrive
 * as regular articles in the same feed, so skipping loses no real story.
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
      .filter((item) => item.link !== null && !isLiveBlogUrl(item.link))
      .map((item) => ({
        source: this.deps.id,
        // Canonicalize the link so tracking params / trailing slashes can't make
        // the same article arrive under different ids across fetches (ADR-0047).
        externalId: canonicalizeUrl(item.link as string),
        title:
          this.deps.id === 'nber'
            ? item.title.replace(NBER_AUTHORS_SUFFIX, '')
            : item.title,
        url: item.link,
        text: item.description,
        publishedAt: item.publishedAt,
        metadata: {
          ...(this.deps.topic ? { topic: this.deps.topic } : {}),
        },
      }));
  }
}
