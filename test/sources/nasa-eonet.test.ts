import { describe, expect, it } from 'vitest';
import { NasaEonetSource } from '../../src/sources/nasa-eonet.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const RESPONSE = {
  events: [
    {
      id: 'EONET_20671',
      title: 'Tropical Storm Higos',
      link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_20671',
      closed: null,
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/products/wp0826.tcw' }],
      geometry: [
        { magnitudeValue: 30, magnitudeUnit: 'kts', date: '2026-06-23T00:00:00Z', coordinates: [145.7, 14.7] },
        { magnitudeValue: 45, magnitudeUnit: 'kts', date: '2026-06-23T18:00:00Z', coordinates: [146.0, 15.0] },
      ],
    },
    { id: 'EONET_NOID', title: '', categories: [], sources: [], geometry: [] },
  ],
};

describe('NasaEonetSource', () => {
  it('maps a natural event to a Climate RawItem using the latest geometry point', async () => {
    const fetcher: JsonFetcher = async (url) => {
      expect(url).toContain('/api/v3/events');
      return RESPONSE;
    };
    const source = new NasaEonetSource({ fetchJson: fetcher, maxItems: 10 });

    const items = await source.extract();

    expect(items).toHaveLength(1); // title-less event dropped
    expect(items[0]).toMatchObject({
      source: 'nasa-eonet',
      externalId: 'EONET_20671',
      title: 'Tropical Storm Higos',
      url: 'https://www.metoc.navy.mil/jtwc/products/wp0826.tcw', // first source url, not the API link
      metadata: { topic: 'Climate', points: 45 }, // latest magnitude
    });
    expect(items[0]?.text).toContain('Severe Storms');
    expect(items[0]?.publishedAt).toBe(Date.parse('2026-06-23T18:00:00Z')); // latest point
  });

  it('respects maxItems and never throws in healthCheck on failure', async () => {
    const ok = new NasaEonetSource({ fetchJson: async () => RESPONSE, maxItems: 0 });
    expect(await ok.extract()).toHaveLength(0);

    const broken = new NasaEonetSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
