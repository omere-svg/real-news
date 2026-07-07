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

  it('retries once after a 429 (GDELT rate-limit) and succeeds', async () => {
    let calls = 0;
    const source = new GdeltSource({
      fetchJson: async () => {
        calls += 1;
        if (calls === 1) throw new Error('GET https://api.gdeltproject.org/... failed: 429 Too Many Requests');
        return { articles: [{ url: 'https://example.com/a', title: 'A', seendate: '20260612T120000Z' }] };
      },
      maxItems: 10,
      retryDelayMs: 1, // keep the test fast; production waits > the 5s policy
    });
    const items = await source.extract();
    expect(calls).toBe(2);
    expect(items).toHaveLength(1);
  });

  it('retries once after a transient network failure ("fetch failed")', async () => {
    let calls = 0;
    const source = new GdeltSource({
      fetchJson: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return { articles: [] };
      },
      maxItems: 10,
      retryDelayMs: 1,
    });
    await expect(source.extract()).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it('does NOT retry non-transient failures (e.g. a 404) and retries a 429 at most once', async () => {
    let calls404 = 0;
    const notFound = new GdeltSource({
      fetchJson: async () => {
        calls404 += 1;
        throw new Error('GET https://api.gdeltproject.org/... failed: 404 Not Found');
      },
      maxItems: 10,
      retryDelayMs: 1,
    });
    await expect(notFound.extract()).rejects.toThrow('404');
    expect(calls404).toBe(1);

    let calls429 = 0;
    const alwaysLimited = new GdeltSource({
      fetchJson: async () => {
        calls429 += 1;
        throw new Error('GET https://api.gdeltproject.org/... failed: 429 Too Many Requests');
      },
      maxItems: 10,
      retryDelayMs: 1,
    });
    await expect(alwaysLimited.extract()).rejects.toThrow('429');
    expect(calls429).toBe(2); // one retry, then surface the failure to the tick
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
