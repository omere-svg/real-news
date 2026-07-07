import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { Clock } from '../scheduler/clock.js';
import type { RawItem } from '../domain/types.js';

const BASE = 'https://en.wikipedia.org/api/rest_v1/feed/featured';

const responseSchema = z.object({
  news: z
    .array(
      z.object({
        story: z.string(),
        links: z
          .array(
            z.object({
              title: z.string().optional(),
              content_urls: z
                .object({ desktop: z.object({ page: z.string() }).partial() })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

const pad = (n: number): string => String(n).padStart(2, '0');

/** A short, stable hash of a string (djb2) — a deterministic dedup key. */
function stableId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Strip HTML tags + decode the common entities, collapse whitespace. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WikipediaDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  readonly clock: Clock;
}

/**
 * Wikipedia adapter over the official REST "featured feed" (ADR-0004). Its
 * `news` block is editor-curated current events. Topic is left to
 * the classifier (events span topics, ADR-0009). The feed is dated, so the
 * adapter reads the date through the Clock seam.
 */
export class WikipediaSource implements SourceAdapter {
  readonly id = 'wikipedia' as const;

  constructor(private readonly deps: WikipediaDeps) {}

  private url(): string {
    const d = new Date(this.deps.clock.now());
    return `${BASE}/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url()))
        .success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(await this.deps.fetchJson(this.url()));
    const now = this.deps.clock.now();

    return (parsed.news ?? [])
      .slice(0, this.deps.maxItems)
      .map((item): RawItem | null => {
        const lead = item.links?.[0];
        const title = plainText(item.story);
        if (!title) return null;
        return {
          source: 'wikipedia' as const,
          // Prefer the lead article title (stable). Only when a blurb has no
          // linked article, key off the headline text — NOT the wall-clock time
          // (mints a new id every tick, ADR-0047) and NOT the list index (ADR-0049:
          // the featured-news list reorders within a day, so the index minted a
          // duplicate of the same blurb). Hash the headline text alone.
          externalId: lead?.title ?? `news:${stableId(title)}`,
          title,
          url: lead?.content_urls?.desktop?.page ?? null,
          text: title,
          publishedAt: now,
          metadata: {},
        };
      })
      .filter((i): i is RawItem => i !== null);
  }
}
