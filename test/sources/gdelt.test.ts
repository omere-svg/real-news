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
    // region/topic left for the classifier (publisher country != subject)
    expect(raw?.metadata.region).toBeUndefined();
    expect(raw?.metadata.topic).toBeUndefined();
  });

  it('tolerates an empty/articles-less response', async () => {
    const source = new GdeltSource({
      fetchJson: async () => ({}),
      maxItems: 10,
    });
    expect(await source.extract()).toEqual([]);
  });

  it('healthCheck returns false (never throws) on failure', async () => {
    const source = new GdeltSource({
      fetchJson: async () => {
        throw new Error('429');
      },
      maxItems: 10,
    });
    await expect(source.healthCheck()).resolves.toBe(false);
  });
});
