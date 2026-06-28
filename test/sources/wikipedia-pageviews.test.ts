import { describe, expect, it } from 'vitest';
import { WikipediaPageviewsSource } from '../../src/sources/wikipedia-pageviews.js';
import { FakeClock } from '../helpers/fake-clock.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const NOW = Date.parse('2026-06-18T10:00:00Z'); // ⇒ previous complete month = 2026/05

function topResponse(project: string, articles: { article: string; views: number; rank: number }[]) {
  return { items: [{ project, year: '2026', month: '05', day: 'all-days', articles }] };
}

const EN = topResponse('en.wikipedia', [
  { article: 'Main_Page', views: 9_000_000, rank: 1 }, // noise: main page
  { article: 'Special:Search', views: 800_000, rank: 2 }, // noise: namespace
  { article: 'Artificial_intelligence', views: 420_000, rank: 3 },
  { article: 'Climate_change', views: 210_000, rank: 4 },
]);
const HE = topResponse('he.wikipedia', [
  { article: 'עמוד_ראשי', views: 620_000, rank: 1 }, // noise: main page
  { article: 'מיוחד:חיפוש', views: 300_000, rank: 2 }, // noise: namespace
  { article: 'מלחמת_חרבות_ברזל', views: 255_000, rank: 3 },
]);

function fetcherFor(byProject: Record<string, unknown>): { fetchJson: JsonFetcher; urls: string[] } {
  const urls: string[] = [];
  const fetchJson: JsonFetcher = async (url) => {
    urls.push(url);
    const project = url.includes('he.wikipedia') ? 'he.wikipedia' : 'en.wikipedia';
    return byProject[project];
  };
  return { fetchJson, urls };
}

describe('WikipediaPageviewsSource', () => {
  it('observes top articles as region-scoped signals, filtering namespace + main-page noise', async () => {
    const { fetchJson, urls } = fetcherFor({ 'en.wikipedia': EN, 'he.wikipedia': HE });
    const source = new WikipediaPageviewsSource({ fetchJson, maxItems: 50, clock: new FakeClock(NOW) });

    const observations = await source.observe();

    // Previous complete month (2026/05) in the URL, both projects polled.
    expect(urls.some((u) => u.includes('/en.wikipedia/all-access/2026/05/'))).toBe(true);
    expect(urls.some((u) => u.includes('/he.wikipedia/all-access/2026/05/'))).toBe(true);

    // Noise dropped: no Main_Page / Special: / מיוחד: / עמוד_ראשי.
    const keys = observations.map((o) => o.key);
    expect(keys.some((k) => k.includes('Main_Page'))).toBe(false);
    expect(keys.some((k) => k.includes('Special:'))).toBe(false);
    expect(keys.some((k) => k.includes('מיוחד:'))).toBe(false);
    expect(keys.some((k) => k.includes('עמוד_ראשי'))).toBe(false);

    // en.wikipedia ⇒ global (topic null), he.wikipedia ⇒ the Israel topic.
    const ai = observations.find((o) => o.key.includes('Artificial_intelligence'));
    expect(ai).toMatchObject({
      source: 'wikipedia-pageviews',
      topic: null,
      value: 420_000,
      observedAt: NOW,
    });
    expect(ai?.key).toBe('en.wikipedia:Artificial_intelligence:202605');

    const war = observations.find((o) => o.topic === 'Israel');
    expect(war).toMatchObject({ topic: 'Israel', value: 255_000 });
  });

  it('caps each project to maxItems (after filtering)', async () => {
    const { fetchJson } = fetcherFor({ 'en.wikipedia': EN, 'he.wikipedia': HE });
    const source = new WikipediaPageviewsSource({ fetchJson, maxItems: 1, clock: new FakeClock(NOW) });

    const observations = await source.observe();
    expect(observations.filter((o) => o.topic === null)).toHaveLength(1);
    expect(observations.filter((o) => o.topic === 'Israel')).toHaveLength(1);
  });

  it('healthCheck is true on a parseable response, false on failure', async () => {
    const ok = new WikipediaPageviewsSource({
      fetchJson: async () => EN,
      maxItems: 50,
      clock: new FakeClock(NOW),
    });
    expect(await ok.healthCheck()).toBe(true);

    const bad = new WikipediaPageviewsSource({
      fetchJson: async () => {
        throw new Error('network down');
      },
      maxItems: 50,
      clock: new FakeClock(NOW),
    });
    expect(await bad.healthCheck()).toBe(false);
  });
});
