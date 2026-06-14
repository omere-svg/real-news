import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

const BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Bill()';

const responseSchema = z.object({
  value: z
    .array(
      z.object({
        BillID: z.number(),
        Name: z.string().nullable().optional(),
        LastUpdatedDate: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

/** Parse an OData date: ISO 8601 or the "/Date(ms)/" form. Null if unparseable. */
function parseODataDate(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(s);
  if (m) return Number(m[1]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export interface KnessetDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * Knesset adapter over the official OData API (ADR-0004). Israeli legislative
 * feed (bills, newest first). By definition Region=Israel, Topic=Politics, so
 * it skips the LLM classifier (ADR-0009).
 */
export class KnessetSource implements SourceAdapter {
  readonly id = 'knesset' as const;

  constructor(private readonly deps: KnessetDeps) {}

  private url(top: number): string {
    return `${BASE}?$top=${top}&$orderby=LastUpdatedDate%20desc&$format=json`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url(1)))
        .success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(
      await this.deps.fetchJson(this.url(this.deps.maxItems)),
    );
    return (parsed.value ?? [])
      .filter((b) => b.Name)
      .map((b) => ({
        source: 'knesset' as const,
        externalId: String(b.BillID),
        title: b.Name as string,
        url: null,
        text: null,
        publishedAt: parseODataDate(b.LastUpdatedDate),
        metadata: { region: 'Israel' as const, topic: 'Politics' as const },
      }));
  }
}
