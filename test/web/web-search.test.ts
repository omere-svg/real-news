import { describe, expect, it } from 'vitest';
import { toWebResults } from '../../src/web/tavily-web-search.js';
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
