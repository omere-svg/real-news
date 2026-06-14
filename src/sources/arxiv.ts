import { XMLParser } from 'fast-xml-parser';
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
 * sets Region=World, Topic=AI (from the cs.AI category), so it skips the LLM
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
    const externalId = entry.id.replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    return {
      source: 'arxiv',
      externalId,
      title: collapse(entry.title),
      url: entry.id,
      text: entry.summary ? collapse(entry.summary) : null,
      publishedAt: entry.published ? Date.parse(entry.published) : null,
      metadata: { region: 'World', topic: 'AI' },
    };
  }
}
