import { describe, expect, it } from 'vitest';
import { GdeltSource } from '../../src/sources/gdelt.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const fakeFetcher: JsonFetcher = async () => ({
  articles: [
    {
      url: 'https://example.com/quake',
      title: 'Earthquake rocks the region',
      seendate: '20260612T120000Z',
      domain: 'example.com',
      sourcecountry: 'United States',
      language: 'English',
    },
  ],
});

describe('GdeltSource', () => {
  it('maps a GDELT article to a RawItem, parsing seendate', async () => {
    const source = new GdeltSource({ fetchJson: fakeFetcher, maxItems: 10 });
    const [raw] = await source.extract();

    expect(raw?.source).toBe('gdelt');
    expect(raw?.externalId).toBe('https://example.com/quake');
    expect(raw?.title).toBe('Earthquake rocks the region');
    expect(raw?.url).toBe('https://example.com/quake');
    expect(raw?.publishedAt).toBe(Date.parse('2026-06-12T12:00:00Z'));
    // topic left for the classifier (publisher country != subject)
    expect(raw?.metadata.topic).toBeUndefined();
  });

  it('extract requests with a generous timeout override (GDELT is slow, ADR-0039)', async () => {
    let seenTimeout: number | undefined;
    const source = new GdeltSource({
      fetchJson: async (_url, options) => {
        seenTimeout = options?.timeoutMs;
        return { articles: [] };
      },
      maxItems: 10,
    });
    await source.extract();
    expect(seenTimeout).toBeGreaterThanOrEqual(20_000);
  });

  it('tolerates an empty/articles-less response', async () => {
    const source = new GdeltSource({
      fetchJson: async () => ({}),
      maxItems: 10,
    });
    expect(await source.extract()).toEqual([]);
  });

  it('healthCheck returns true without a pre-flight fetch (respects 1-req/5s, ADR-0039)', async () => {
    let calls = 0;
    const source = new GdeltSource({
      fetchJson: async () => {
        calls += 1;
        return {};
      },
      maxItems: 10,
    });
    // No probe request — so extract() is the only GDELT call per tick.
    await expect(source.healthCheck()).resolves.toBe(true);
    expect(calls).toBe(0);
  });
});
