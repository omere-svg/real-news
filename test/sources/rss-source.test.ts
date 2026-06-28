import { describe, expect, it } from 'vitest';
import { RssSource } from '../../src/sources/rss-source.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Story one</title><link>https://g.com/1</link>
    <description>Summary one.</description><pubDate>Tue, 10 Jun 2026 12:00:00 GMT</pubDate></item>
  <item><title>No link here</title><description>dropped</description></item>
</channel></rss>`;

const feedFetcher: JsonFetcher = async (_url, opts) => {
  if (opts?.as !== 'text') throw new Error('RSS must request text');
  return FEED;
};

describe('RssSource', () => {
  it('maps RSS items to RawItems with the configured topic', async () => {
    const source = new RssSource({
      id: 'guardian',
      feedUrl: 'https://x/rss',
      topic: 'Geopolitics',
      fetchJson: feedFetcher,
      maxItems: 10,
    });
    const items = await source.extract();

    expect(items).toHaveLength(1); // the link-less item is dropped
    expect(items[0]).toMatchObject({
      source: 'guardian',
      externalId: 'https://g.com/1',
      title: 'Story one',
      url: 'https://g.com/1',
      text: 'Summary one.',
      metadata: { topic: 'Geopolitics' },
    });
    expect(items[0]?.publishedAt).toBe(Date.parse('Tue, 10 Jun 2026 12:00:00 GMT'));
  });

  it('omits topic when not configured (classifier decides)', async () => {
    const source = new RssSource({
      id: 'timesofisrael',
      feedUrl: 'https://x/rss',
      fetchJson: feedFetcher,
      maxItems: 10,
    });
    const [item] = await source.extract();
    expect(item?.metadata.topic).toBeUndefined();
  });

  it('respects maxItems', async () => {
    const source = new RssSource({
      id: 'nber',
      feedUrl: 'https://x/rss',
      topic: 'Business',
      fetchJson: feedFetcher,
      maxItems: 0,
    });
    expect(await source.extract()).toHaveLength(0);
  });

  it('healthCheck returns false (never throws) on failure', async () => {
    const source = new RssSource({
      id: 'nature',
      feedUrl: 'https://x/rss',
      topic: 'Science',
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(source.healthCheck()).resolves.toBe(false);
  });
});
