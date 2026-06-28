import { describe, expect, it } from 'vitest';
import { HackerNewsSource } from '../../src/sources/hacker-news.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const BASE = 'https://hacker-news.firebaseio.com/v0';
const TOP = `${BASE}/topstories.json`;
const item = (id: number) => `${BASE}/item/${id}.json`;

/** Build a JsonFetcher from a URL→response map; unknown URLs reject. */
function fakeFetcher(map: Record<string, unknown>): JsonFetcher {
  return async (url: string) => {
    if (!(url in map)) throw new Error(`unexpected url: ${url}`);
    return map[url];
  };
}

const hnStory = (over: Record<string, unknown> = {}) => ({
  id: 1,
  type: 'story',
  title: 'A breakthrough in AI',
  url: 'https://example.com/ai',
  score: 256,
  descendants: 88,
  time: 1_700_000_000, // seconds
  by: 'pg',
  ...over,
});

describe('HackerNewsSource', () => {
  it('maps an HN item to a RawItem', async () => {
    const source = new HackerNewsSource({
      fetchJson: fakeFetcher({ [TOP]: [1], [item(1)]: hnStory() }),
      maxItems: 10,
    });

    const [raw] = await source.extract();

    expect(raw).toMatchObject({
      source: 'hackernews',
      externalId: '1',
      title: 'A breakthrough in AI',
      url: 'https://example.com/ai',
      publishedAt: 1_700_000_000_000, // seconds → ms
    });
    expect(raw?.metadata.points).toBe(256);
    expect(raw?.metadata.mentions).toBe(88);
  });

  it('respects maxItems', async () => {
    const source = new HackerNewsSource({
      fetchJson: fakeFetcher({
        [TOP]: [1, 2, 3, 4, 5],
        [item(1)]: hnStory({ id: 1 }),
        [item(2)]: hnStory({ id: 2 }),
      }),
      maxItems: 2,
    });

    const items = await source.extract();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.externalId)).toEqual(['1', '2']);
  });

  it('skips dead/null items without crashing', async () => {
    const source = new HackerNewsSource({
      fetchJson: fakeFetcher({
        [TOP]: [1, 2],
        [item(1)]: null, // deleted
        [item(2)]: hnStory({ id: 2 }),
      }),
      maxItems: 10,
    });

    const items = await source.extract();
    expect(items.map((i) => i.externalId)).toEqual(['2']);
  });

  it('leaves region and topic unset, deferring to the classifier (ADR-0009)', async () => {
    const source = new HackerNewsSource({
      fetchJson: fakeFetcher({ [TOP]: [1], [item(1)]: hnStory() }),
      maxItems: 10,
    });

    const [raw] = await source.extract();
    expect(raw?.metadata.topic).toBeUndefined();
  });

  it('healthCheck returns true when the endpoint responds', async () => {
    const source = new HackerNewsSource({
      fetchJson: fakeFetcher({ [TOP]: [1, 2, 3] }),
      maxItems: 10,
    });
    expect(await source.healthCheck()).toBe(true);
  });

  it('healthCheck returns false (never throws) when the fetch fails', async () => {
    const source = new HackerNewsSource({
      fetchJson: async () => {
        throw new Error('network down');
      },
      maxItems: 10,
    });
    await expect(source.healthCheck()).resolves.toBe(false);
  });
});
