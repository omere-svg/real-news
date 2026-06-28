import { describe, expect, it } from 'vitest';
import { UsgsQuakesSource } from '../../src/sources/usgs-quakes.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const RESPONSE = {
  features: [
    {
      id: 'us6000t8ta',
      properties: {
        mag: 6.1,
        place: '225 km NE of Lospalos, Timor Leste',
        time: 1782646531479,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000t8ta',
        title: 'M 6.1 - 225 km NE of Lospalos, Timor Leste',
        tsunami: 0,
      },
    },
    { id: 'no-mag', properties: { place: 'nowhere', time: 1782646531479 } },
  ],
};

describe('UsgsQuakesSource', () => {
  it('maps a quake to a Climate RawItem with magnitude as a severity signal', async () => {
    const fetcher: JsonFetcher = async (url) => {
      expect(url).toContain('earthquake.usgs.gov');
      return RESPONSE;
    };
    const source = new UsgsQuakesSource({ fetchJson: fetcher, maxItems: 10 });

    const items = await source.extract();

    expect(items).toHaveLength(1); // mag-less feature dropped
    expect(items[0]).toMatchObject({
      source: 'usgs-quakes',
      externalId: 'us6000t8ta',
      title: 'M 6.1 - 225 km NE of Lospalos, Timor Leste',
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000t8ta',
      metadata: { topic: 'Climate', points: 6.1 },
    });
    expect(items[0]?.publishedAt).toBe(1782646531479); // epoch ms straight through
  });

  it('respects maxItems and never throws in healthCheck on failure', async () => {
    const ok = new UsgsQuakesSource({ fetchJson: async () => RESPONSE, maxItems: 0 });
    expect(await ok.extract()).toHaveLength(0);

    const broken = new UsgsQuakesSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
