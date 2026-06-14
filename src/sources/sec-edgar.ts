import { z } from 'zod';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

const BASE = 'https://efts.sec.gov/LATEST/search-index';
const DEFAULT_QUERY = 'acquisition OR merger OR earnings OR offering';
// SEC requires a descriptive User-Agent with contact info.
const HEADERS = { 'user-agent': 'project-horizon (horizon@example.com)' };

const responseSchema = z.object({
  hits: z.object({
    hits: z.array(
      z.object({
        _id: z.string(),
        _source: z.object({
          display_names: z.array(z.string()).optional(),
          form: z.string().nullable().optional(),
          root_form: z.string().nullable().optional(),
          file_date: z.string().optional(),
          ciks: z.array(z.string()).optional(),
        }),
      }),
    ),
  }),
});

/** "Apple Inc. (AAPL) (CIK 0000320…)" → "Apple Inc." */
function cleanName(name: string | undefined): string {
  return (name ?? 'Unknown filer').replace(/\s*\(CIK.*$/, '').trim();
}

/** Best-effort EDGAR document URL from the _id ("accession:file") + cik. */
function edgarUrl(id: string, cik: string | undefined): string | null {
  if (!cik) return null;
  const [accession, file] = id.split(':');
  if (!accession || !file) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${file}`;
}

export interface SecEdgarDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  /** Full-text search query (defaults to broad finance terms). */
  readonly query?: string;
}

/**
 * SEC EDGAR adapter over the official full-text search API (ADR-0004). US
 * corporate filings (8-Ks = material finance events). Region=World,
 * Topic=Business (ADR-0009). Requires a descriptive User-Agent header.
 */
export class SecEdgarSource implements SourceAdapter {
  readonly id = 'secedgar' as const;

  constructor(private readonly deps: SecEdgarDeps) {}

  private url(): string {
    const q = encodeURIComponent(this.deps.query ?? DEFAULT_QUERY);
    return `${BASE}?q=${q}&forms=8-K`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(
        await this.deps.fetchJson(this.url(), { headers: HEADERS }),
      ).success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const parsed = responseSchema.parse(
      await this.deps.fetchJson(this.url(), { headers: HEADERS }),
    );
    return parsed.hits.hits.slice(0, this.deps.maxItems).map((hit) => {
      const s = hit._source;
      const form = s.form ?? s.root_form ?? 'filing';
      return {
        source: 'secedgar' as const,
        externalId: hit._id,
        title: `${cleanName(s.display_names?.[0])}: ${form} filing`,
        url: edgarUrl(hit._id, s.ciks?.[0]),
        text: null,
        publishedAt: s.file_date ? Date.parse(s.file_date) : null,
        metadata: { region: 'World' as const, topic: 'Business' as const },
      };
    });
  }
}
