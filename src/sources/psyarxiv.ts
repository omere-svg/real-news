import { z } from 'zod';
import { parseDateOrNull } from './date.js';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

// OSF JSON:API, newest first, psyarxiv provider only.
const FEED_URL =
  'https://api.osf.io/v2/preprints/?filter[provider]=psyarxiv' +
  '&sort=-date_published&page[size]=';

const feedSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        attributes: z.object({
          title: z.string().optional(),
          description: z.string().nullable().optional(),
          date_published: z.string().nullable().optional(),
        }),
        links: z.object({ html: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

export interface PsyArxivDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * PsyArXiv adapter over the open OSF JSON:API (ADR-0021) — the "arXiv of
 * psychology". Topic=Science (psychology has no dedicated Topic;
 * skips the classifier, ADR-0009). Title + abstract + link only; preprints are
 * flagged un-peer-reviewed in the brief.
 */
export class PsyArxivSource implements SourceAdapter {
  readonly id = 'psyarxiv' as const;

  private url(): string {
    return `${FEED_URL}${this.deps.maxItems}`;
  }

  constructor(private readonly deps: PsyArxivDeps) {}

  async healthCheck(): Promise<boolean> {
    try {
      return feedSchema.safeParse(await this.deps.fetchJson(this.url())).success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = feedSchema.parse(await this.deps.fetchJson(this.url()));
    return (parsed.data ?? [])
      .filter((p) => p.attributes.title)
      .map((p) => ({
        source: 'psyarxiv' as const,
        externalId: p.id,
        title: p.attributes.title as string,
        url: p.links?.html ?? null,
        text: p.attributes.description ?? null,
        publishedAt: parseDateOrNull(p.attributes.date_published),
        metadata: { topic: 'Science' as const },
      }));
  }
}
