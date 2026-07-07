import { z } from 'zod';
import { parseDateOrNull } from './date.js';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

const BASE = 'https://www.who.int/api/news/diseaseoutbreaknews';
const ITEM_BASE = 'https://www.who.int/emergencies/disease-outbreak-news/item';

const reportSchema = z.object({
  Id: z.string(),
  Title: z.string().nullable().optional(),
  UrlName: z.string().nullable().optional(),
  PublicationDate: z.string().nullable().optional(),
  Overview: z.string().nullable().optional(),
  Summary: z.string().nullable().optional(),
});
type Report = z.infer<typeof reportSchema>;

const responseSchema = z.object({ value: z.array(reportSchema).optional() });

export interface WhoOutbreaksDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * WHO Disease Outbreak News adapter (ADR-0031) — the authoritative feed for the
 * `Health` Topic (epidemics/outbreaks), which had no source. OData JSON, same
 * family as the Knesset adapters. Topic=Health skips the classifier (ADR-0009).
 * MUST order newest-first: the API's default order is oldest-first (it would
 * otherwise ingest decades-old reports). HTML `Overview` is stripped to a plain
 * "what happened"; metadata + summary + link only, never the full page.
 */
export class WhoOutbreaksSource implements SourceAdapter {
  readonly id = 'who-outbreaks' as const;

  constructor(private readonly deps: WhoOutbreaksDeps) {}

  private url(top: number): string {
    // $orderby is essential — the API defaults to oldest-first.
    return `${BASE}?$orderby=${encodeURIComponent('PublicationDate desc')}&$top=${top}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url(1))).success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(
      await this.deps.fetchJson(this.url(this.deps.maxItems)),
    );
    return (parsed.value ?? [])
      .slice(0, this.deps.maxItems)
      .map((r) => this.toRawItem(r))
      .filter((i): i is RawItem => i !== null);
  }

  private toRawItem(r: Report): RawItem | null {
    const title = r.Title?.trim();
    if (!title) return null;
    return {
      source: 'who-outbreaks',
      externalId: r.Id,
      title,
      url: r.UrlName ? `${ITEM_BASE}/${r.UrlName}` : null,
      text: stripHtml(r.Overview ?? r.Summary ?? null),
      publishedAt: parseDateOrNull(r.PublicationDate),
      metadata: { topic: 'Health' },
    };
  }
}

/** Strip HTML tags + decode the few common entities, collapse whitespace. */
function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&rsquo;|&lsquo;/g, '’')
    .replace(/&rdquo;|&ldquo;/g, '”')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:#\d+|[a-z]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}
