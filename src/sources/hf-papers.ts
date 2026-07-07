import { z } from 'zod';
import { parseDateOrNull } from './date.js';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem, SourceMetadata } from '../domain/types.js';

const FEED_URL = 'https://huggingface.co/api/daily_papers';

/** Each entry wraps a `paper`; engagement (`numComments`) sits at the top level. */
const feedSchema = z.array(
  z.object({
    numComments: z.number().optional(),
    paper: z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      summary: z.string().optional(),
      ai_summary: z.string().optional(),
      upvotes: z.number().optional(),
      publishedAt: z.string().optional(),
    }),
  }),
);

export interface HfPapersDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * Hugging Face Daily Papers adapter (ADR-0021). The community-ranked "what's hot
 * in AI" layer arXiv's firehose lacks. Topic=AI (skips the
 * classifier, ADR-0009); a BOTH source — `upvotes`→points and `numComments`→
 * mentions enrich significance (ADR-0008). Summaries + link only.
 */
export class HfPapersSource implements SourceAdapter {
  readonly id = 'hf-papers' as const;

  constructor(private readonly deps: HfPapersDeps) {}

  async healthCheck(): Promise<boolean> {
    try {
      return feedSchema.safeParse(await this.deps.fetchJson(FEED_URL)).success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const feed = feedSchema
      .parse(await this.deps.fetchJson(FEED_URL))
      .slice(0, this.deps.maxItems);

    return feed
      .filter((e) => e.paper.id && e.paper.title)
      .map((e) => {
        const p = e.paper;
        const metadata: SourceMetadata = {
          topic: 'AI',
          ...(typeof p.upvotes === 'number' ? { points: p.upvotes } : {}),
          ...(typeof e.numComments === 'number' ? { mentions: e.numComments } : {}),
        };
        return {
          source: 'hf-papers' as const,
          externalId: p.id as string,
          title: p.title as string,
          url: `https://huggingface.co/papers/${p.id}`,
          text: p.ai_summary ?? p.summary ?? null,
          publishedAt: parseDateOrNull(p.publishedAt),
          metadata,
        };
      });
  }
}
