import { describe, expect, it } from 'vitest';
import { WikipediaSource } from '../../src/sources/wikipedia.js';
import { FakeClock } from '../helpers/fake-clock.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const NOW = Date.parse('2026-06-13T10:00:00Z');

const FEED = {
  news: [
    {
      story: '<p>A <b>major</b> diplomatic summit  concluded today.</p>',
      links: [
        {
          title: 'Major_summit',
          content_urls: {
            desktop: { page: 'https://en.wikipedia.org/wiki/Major_summit' },
          },
        },
      ],
    },
  ],
};

describe('WikipediaSource', () => {
  it('maps a current-events item to a RawItem and uses the clock date in the URL', async () => {
    let requested = '';
    const fetchJson: JsonFetcher = async (url) => {
      requested = url;
      return FEED;
    };
    const source = new WikipediaSource({
      fetchJson,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });

    const [raw] = await source.extract();

    expect(requested).toContain('/featured/2026/06/13');
    expect(raw?.source).toBe('wikipedia');
    expect(raw?.externalId).toBe('Major_summit');
    expect(raw?.title).toBe('A major diplomatic summit concluded today.'); // tags stripped, ws collapsed
    expect(raw?.url).toBe('https://en.wikipedia.org/wiki/Major_summit');
    expect(raw?.metadata.topic).toBeUndefined(); // classifier decides
  });

  it('healthCheck returns false (never throws) on failure', async () => {
    const s = new WikipediaSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
      clock: new FakeClock(NOW),
    });
    await expect(s.healthCheck()).resolves.toBe(false);
  });
});
