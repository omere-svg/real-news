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

// Real NBER feed shape (observed 2026-07-07): every working-paper title carries
// a trailing " -- by <authors>" suffix.
const NBER_FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Seemingly Anchored Inflation Expectations -- by Ulrike Malmendier, Stefan Nagel</title>
    <link>https://www.nber.org/papers/w99901</link></item>
  <item><title>Baby Busts and Growth Booms: Demographic Change and the Macroeconomy — by Daron Acemoglu, David Autor</title>
    <link>https://www.nber.org/papers/w99902</link></item>
  <item><title>Growth by Design</title>
    <link>https://www.nber.org/papers/w99903</link></item>
</channel></rss>`;

// Real Guardian world-feed shape (observed 2026-07-07): a live-blog item whose
// title names one blurb while the description bundles unrelated ones.
const GUARDIAN_FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Australia news live: accused double murderer’s mother granted bail</title>
    <link>https://www.theguardian.com/australia-news/live/2026/jul/07/australia-news-live-penny-wong-china-missile-test</link>
    <description>Follow today’s news live. Richard Marles said he doubted China tested the long-range weapon.</description></item>
  <item><title>Two dead after storm hits coast</title>
    <link>https://www.theguardian.com/world/2026/jul/07/storm-hits-coast</link>
    <description>A regular article.</description></item>
</channel></rss>`;

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

  it('strips the NBER "-- by <authors>" title suffix (both dash styles)', async () => {
    const source = new RssSource({
      id: 'nber',
      feedUrl: 'https://x/rss',
      topic: 'Business',
      fetchJson: async () => NBER_FEED,
      maxItems: 10,
    });
    const items = await source.extract();
    expect(items.map((i) => i.title)).toEqual([
      'Seemingly Anchored Inflation Expectations',
      'Baby Busts and Growth Booms: Demographic Change and the Macroeconomy',
      'Growth by Design', // "by" inside a title without the dash separator is untouched
    ]);
  });

  it('leaves a "-- by" suffix intact for non-NBER feeds', async () => {
    const source = new RssSource({
      id: 'guardian',
      feedUrl: 'https://x/rss',
      fetchJson: async () => NBER_FEED,
      maxItems: 1,
    });
    const [item] = await source.extract();
    expect(item?.title).toBe(
      'Seemingly Anchored Inflation Expectations -- by Ulrike Malmendier, Stefan Nagel',
    );
  });

  it('skips live-blog items (a /live/ URL bundles unrelated blurbs)', async () => {
    const source = new RssSource({
      id: 'guardian',
      feedUrl: 'https://x/rss',
      topic: 'Geopolitics',
      fetchJson: async () => GUARDIAN_FEED,
      maxItems: 10,
    });
    const items = await source.extract();
    expect(items.map((i) => i.title)).toEqual(['Two dead after storm hits coast']);
  });

  it('does not skip articles merely containing "live" outside a path segment', async () => {
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Olive harvest begins</title>
        <link>https://www.theguardian.com/world/2026/jul/07/lives-changed-by-olive-harvest</link></item>
    </channel></rss>`;
    const source = new RssSource({
      id: 'guardian',
      feedUrl: 'https://x/rss',
      fetchJson: async () => feed,
      maxItems: 10,
    });
    const items = await source.extract();
    expect(items).toHaveLength(1);
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
