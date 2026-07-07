import { describe, expect, it, vi } from 'vitest';
import { TavilyWebSearch, toWebResults } from '../../src/web/tavily-web-search.js';
import { ResilientWebSearch } from '../../src/web/resilient-web-search.js';
import type { WebSearch } from '../../src/web/web-search.js';

describe('toWebResults (Tavily mapping)', () => {
  it('maps results, falling back to the url for a missing title and "" for content', () => {
    const raw = {
      results: [
        { title: 'Merger approved', url: 'https://a.example/m', content: 'Regulators cleared it.' },
        { url: 'https://b.example/x' }, // no title/content
        { title: 'no url', content: 'dropped' }, // no url ⇒ dropped
      ],
    };
    expect(toWebResults(raw)).toEqual([
      { title: 'Merger approved', url: 'https://a.example/m', snippet: 'Regulators cleared it.' },
      { title: 'https://b.example/x', url: 'https://b.example/x', snippet: '' },
    ]);
  });

  it('tolerates a missing or malformed payload', () => {
    expect(toWebResults({})).toEqual([]);
    expect(toWebResults(null)).toEqual([]);
    expect(toWebResults({ results: 'nope' })).toEqual([]);
  });
});

describe('TavilyWebSearch (fetch contract)', () => {
  it('POSTs the api key + query to Tavily and maps the results', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ results: [{ title: 't', url: 'https://x', content: 's' }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const ws = new TavilyWebSearch({ apiKey: 'KEY', maxResults: 3, fetchImpl: impl });
    const results = await ws.search('quake toll');

    expect(calls[0]?.url).toBe('https://api.tavily.com/search');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      api_key: 'KEY',
      query: 'quake toll',
      max_results: 3,
      search_depth: 'basic',
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal); // hung-socket guard
    expect(results).toEqual([{ title: 't', url: 'https://x', snippet: 's' }]);
  });

  it('throws on a non-OK response, naming the status', async () => {
    const impl = (async () => new Response('no', { status: 429 })) as unknown as typeof fetch;
    const ws = new TavilyWebSearch({ apiKey: 'KEY', fetchImpl: impl });
    await expect(ws.search('q')).rejects.toThrow('tavily search 429');
  });
});

describe('ResilientWebSearch', () => {
  it('passes results through when the provider succeeds', async () => {
    const inner: WebSearch = {
      search: async () => [{ title: 't', url: 'https://x', snippet: 's' }],
    };
    const ws = new ResilientWebSearch(inner);
    expect(await ws.search('q')).toEqual([{ title: 't', url: 'https://x', snippet: 's' }]);
  });

  it('degrades to no results when the provider throws', async () => {
    const inner: WebSearch = {
      search: async () => {
        throw new Error('provider down');
      },
    };
    const ws = new ResilientWebSearch(inner, () => {});
    expect(await ws.search('q')).toEqual([]);
  });
});
