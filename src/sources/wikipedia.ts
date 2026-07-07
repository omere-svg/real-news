import { z } from 'zod';
import { collapseWhitespace, decodeEntities, stripHtml } from '../text/clean.js';
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

/** Strip HTML tags + decode entities, collapse whitespace (shared, ADR-0051). */
function plainText(html: string): string {
  return collapseWhitespace(decodeEntities(stripHtml(html)));
}

/** Headline length above which we look for a clause boundary to cut at. */
const MAX_HEADLINE_CHARS = 110;
/** Never cut a headline shorter than this — it would drop the event itself. */
const MIN_HEADLINE_CHARS = 60;

/**
 * Clause boundaries usable as headline cut points: a comma/semicolon followed by
 * whitespace (so "3,500" never splits), or a trailing participial clause
 * (" leaving ...", " causing ...").
 */
const CLAUSE_BOUNDARY = /[,;](?=\s)|\s(?=(?:leaving|causing)\s)/g;

/**
 * Shape a current-events sentence into a headline (live judge finding: full
 * sentences like "Two earthquakes strike Venezuela, ... missing." read as prose,
 * not headlines). Trims the trailing period; if still over MAX_HEADLINE_CHARS,
 * cuts at the last clause boundary in [MIN, MAX] chars. With no usable boundary
 * the sentence stays whole — never hard-truncate mid-word. The full sentence is
 * always preserved in the item's text, so nothing is lost.
 */
function toHeadline(sentence: string): string {
  const trimmed = sentence.replace(/\.\s*$/, '');
  if (trimmed.length <= MAX_HEADLINE_CHARS) return trimmed;

  let cut = -1;
  for (const m of trimmed.matchAll(CLAUSE_BOUNDARY)) {
    const i = m.index ?? -1;
    if (i >= MIN_HEADLINE_CHARS && i <= MAX_HEADLINE_CHARS) cut = Math.max(cut, i);
  }
  return cut === -1 ? trimmed : trimmed.slice(0, cut).trimEnd();
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
        const sentence = plainText(item.story);
        if (!sentence) return null;
        return {
          source: 'wikipedia' as const,
          // Prefer the lead article title (stable). Only when a blurb has no
          // linked article, key off the FULL sentence text — NOT the wall-clock
          // time (mints a new id every tick, ADR-0047), NOT the list index
          // (ADR-0049: the list reorders within a day), and not the shaped
          // headline (its shaping rules may evolve; the sentence is the feed's
          // own stable text).
          externalId: lead?.title ?? `news:${stableId(sentence)}`,
          // Headline-shaped title; the untouched sentence stays in `text` so the
          // Reasoner and renderers keep the full information.
          title: toHeadline(sentence),
          url: lead?.content_urls?.desktop?.page ?? null,
          text: sentence,
          publishedAt: now,
          metadata: {},
        };
      })
      .filter((i): i is RawItem => i !== null);
  }
}
