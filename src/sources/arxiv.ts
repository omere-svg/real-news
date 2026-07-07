import { XMLParser } from 'fast-xml-parser';
import { parseDateOrNull } from './date.js';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { RawItem } from '../domain/types.js';

const QUERY =
  'https://export.arxiv.org/api/query?search_query=cat:cs.AI' +
  '&sortBy=submittedDate&sortOrder=descending&max_results=';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

interface AtomEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  link?: unknown;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

export interface ArxivDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
}

/**
 * arXiv adapter over the official Atom API (ADR-0004). AI/research source —
 * sets Topic=AI (from the cs.AI category), so it skips the LLM
 * classifier (ADR-0009).
 */
export class ArxivSource implements SourceAdapter {
  readonly id = 'arxiv' as const;

  constructor(private readonly deps: ArxivDeps) {}

  async healthCheck(): Promise<boolean> {
    try {
      const xml = await this.deps.fetchJson(`${QUERY}1`, { as: 'text' });
      return typeof xml === 'string' && xml.includes('<feed');
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const xml = await this.deps.fetchJson(`${QUERY}${this.deps.maxItems}`, {
      as: 'text',
    });
    const parsed = parser.parse(String(xml)) as { feed?: { entry?: unknown } };
    const entries = parsed.feed?.entry;
    const list: AtomEntry[] = Array.isArray(entries)
      ? entries
      : entries
        ? [entries as AtomEntry]
        : [];

    return list
      .map((e) => this.toRawItem(e))
      .filter((i): i is RawItem => i !== null);
  }

  private toRawItem(entry: AtomEntry): RawItem | null {
    if (!entry.id || !entry.title) return null;
    // Strip both the abs/ prefix AND the trailing version (v1/v2/…): a paper
    // revised inside the recent-submissions window keeps its identity instead of
    // arriving as a duplicate raw_item that only cluster-merge can reunite (ADR-0049).
    const externalId = entry.id
      .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
      .replace(/v\d+$/, '');
    return {
      source: 'arxiv',
      externalId,
      title: collapse(entry.title),
      url: entry.id,
      text: entry.summary ? collapse(entry.summary) : null,
      publishedAt: parseDateOrNull(entry.published),
      metadata: { topic: 'AI' },
    };
  }
}
