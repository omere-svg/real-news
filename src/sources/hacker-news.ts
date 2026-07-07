import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem, SourceMetadata } from '../domain/types.js';

const BASE = 'https://hacker-news.firebaseio.com/v0';
const TOP_STORIES_URL = `${BASE}/topstories.json`;
const itemUrl = (id: number): string => `${BASE}/item/${id}.json`;

const topStoriesSchema = z.array(z.number());

/** HN items are loosely typed; everything beyond `id` may be absent. */
const hnItemSchema = z
  .object({
    id: z.number(),
    title: z.string().optional(),
    url: z.string().optional(),
    text: z.string().optional(),
    score: z.number().optional(),
    descendants: z.number().optional(),
    time: z.number().optional(),
  })
  .nullable();

export interface HackerNewsDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * Hacker News adapter over the official Firebase API (ADR-0004). Global
 * tech/AI source. Leaves Topic unset — HN doesn't expose it reliably, so
 * classification falls back to the Reasoner (ADR-0009).
 */
export class HackerNewsSource implements SourceAdapter {
  readonly id = 'hackernews' as const;

  constructor(private readonly deps: HackerNewsDeps) {}

  async healthCheck(): Promise<boolean> {
    try {
      topStoriesSchema.parse(await this.deps.fetchJson(TOP_STORIES_URL));
      return true;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const ids = topStoriesSchema
      .parse(await this.deps.fetchJson(TOP_STORIES_URL))
      .slice(0, this.deps.maxItems);

    const raw = await Promise.all(
      ids.map((id) => this.fetchItem(id)),
    );
    return raw.filter((item): item is RawItem => item !== null);
  }

  private async fetchItem(id: number): Promise<RawItem | null> {
    // Isolate a single item's fetch/parse failure — one timed-out item must not
    // reject Promise.all and lose the whole HN batch this tick (ADR-0051).
    let raw: unknown;
    try {
      raw = await this.deps.fetchJson(itemUrl(id));
    } catch {
      return null;
    }
    const parsed = hnItemSchema.safeParse(raw);
    if (!parsed.success || parsed.data === null) return null;

    const item = parsed.data;
    if (!item.title) return null; // not a presentable story

    const metadata: SourceMetadata = {
      ...(typeof item.score === 'number' ? { points: item.score } : {}),
      ...(typeof item.descendants === 'number'
        ? { mentions: item.descendants }
        : {}),
    };

    return {
      source: 'hackernews',
      externalId: String(item.id),
      title: item.title,
      url: item.url ?? null,
      text: item.text ?? null,
      publishedAt: typeof item.time === 'number' ? item.time * 1000 : null,
      metadata,
    };
  }
}
