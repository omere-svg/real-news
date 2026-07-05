import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_QUERY =
  '(geopolitics OR diplomacy OR conflict OR sanctions OR election OR economy)';

const responseSchema = z.object({
  articles: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
        seendate: z.string().optional(),
      }),
    )
    .optional(),
});

/** GDELT seendate "YYYYMMDDTHHMMSSZ" → epoch ms (null if unparseable). */
function parseSeenDate(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

/**
 * GDELT's doc API is legitimately slow — an artlist call routinely takes ~13s,
 * over the 10s global fetch timeout (ADR-0039). Give it a generous per-request
 * timeout so the world-news feed doesn't time out every tick. Ticks are minutes
 * apart, so this never bumps GDELT's ~1-req/5s limit.
 */
const GDELT_TIMEOUT_MS = 25_000;

export interface GdeltDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  /** GDELT query string (defaults to a broad geopolitics/world query). */
  readonly query?: string;
  /** Per-request timeout override; GDELT is slow, so default to a generous value. */
  readonly timeoutMs?: number;
}

/**
 * GDELT 2.1 Doc API adapter (ADR-0004). Global news/events feed. Leaves
 * Topic to the classifier (ADR-0009) — GDELT's sourcecountry is the
 * publisher, not the story's subject. Respect GDELT's 1-request/5-second limit
 * (one call per tick).
 */
export class GdeltSource implements SourceAdapter {
  readonly id = 'gdelt' as const;

  constructor(private readonly deps: GdeltDeps) {}

  private url(maxRecords: number): string {
    const query = encodeURIComponent(this.deps.query ?? DEFAULT_QUERY);
    return `${BASE}?query=${query}&mode=artlist&format=json&sort=DateDesc&maxrecords=${maxRecords}`;
  }

  /**
   * No pre-flight probe (ADR-0039). GDELT enforces ~1 request / 5 seconds, so a
   * healthCheck fetch here followed immediately by the extract fetch is two calls
   * back-to-back — which trips the limit and is exactly why GDELT skipped every
   * tick. Return true so extract() makes the single request the API allows; the
   * pipeline's try/catch still isolates a genuinely-down GDELT as a `failed`
   * source (with its error), rather than a silent skip.
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(
      await this.deps.fetchJson(this.url(this.deps.maxItems), {
        timeoutMs: this.deps.timeoutMs ?? GDELT_TIMEOUT_MS,
      }),
    );
    return (parsed.articles ?? [])
      .filter((a) => a.title)
      .map((a) => ({
        source: 'gdelt' as const,
        externalId: a.url,
        title: a.title as string,
        url: a.url,
        text: null,
        publishedAt: parseSeenDate(a.seendate),
        metadata: {},
      }));
  }
}
