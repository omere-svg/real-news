import type { WebResult, WebSearch } from './web-search.js';

/**
 * A `WebSearch` over the Tavily API (ADR-0029) — the thin provider half, the
 * only part that touches the open internet. Mirrors the other network adapters
 * (e.g. `BotApiTransport`): the response→domain mapping (`toWebResults`) is pure
 * and unit-tested; the network call itself is not. The API key comes from the
 * environment (`TAVILY_API_KEY`), never config.
 */
export interface TavilyWebSearchDeps {
  /** Tavily API key from `TAVILY_API_KEY` (env, never config). */
  readonly apiKey: string;
  /** Max results to request per query. */
  readonly maxResults?: number;
  /** Abort the request after this many ms. */
  readonly timeoutMs?: number;
  /** Injectable for testing; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const TAVILY_URL = 'https://api.tavily.com/search';

/** Map a raw Tavily response to domain results, dropping malformed entries. */
export function toWebResults(raw: unknown): WebResult[] {
  const results = (raw as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];

  const out: WebResult[] = [];
  for (const entry of results) {
    const e = entry as { title?: unknown; url?: unknown; content?: unknown };
    if (typeof e.url === 'string') {
      out.push({
        title: typeof e.title === 'string' ? e.title : e.url,
        url: e.url,
        snippet: typeof e.content === 'string' ? e.content : '',
      });
    }
  }
  return out;
}

export class TavilyWebSearch implements WebSearch {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: TavilyWebSearchDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async search(query: string): Promise<readonly WebResult[]> {
    const res = await this.fetchImpl(TAVILY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: this.deps.apiKey,
        query,
        max_results: this.deps.maxResults ?? 5,
        search_depth: 'basic',
      }),
      signal: AbortSignal.timeout(this.deps.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`tavily search ${res.status}`);
    return toWebResults(await res.json());
  }
}
