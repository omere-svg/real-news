import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

const BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Bill()';

/**
 * Public bill page on the Knesset legislation portal. The OData `BillID` is the
 * site's `lawitemid` (verified), so this resolves to the real bill page — the
 * provenance link the brief shows (ADR-0027).
 */
function billUrl(billId: number): string {
  return `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=${billId}`;
}

const responseSchema = z.object({
  value: z
    .array(
      z.object({
        BillID: z.number(),
        Name: z.string().nullable().optional(),
        // The bill's official summary — usually null until it becomes law.
        SummaryLaw: z.string().nullable().optional(),
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
 * feed (bills, newest first). By definition Topic=Israel, so it skips the LLM
 * classifier (ADR-0009).
 */
export class KnessetSource implements SourceAdapter {
  readonly id = 'knesset' as const;

  constructor(private readonly deps: KnessetDeps) {}

  private url(top: number): string {
    return `${BASE}?$top=${top}&$orderby=LastUpdatedDate%20desc&$select=BillID,Name,SummaryLaw,LastUpdatedDate&$format=json`;
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
        url: billUrl(b.BillID),
        text: b.SummaryLaw ?? null,
        publishedAt: parseODataDate(b.LastUpdatedDate),
        metadata: { topic: 'Israel' as const },
      }));
  }
}
