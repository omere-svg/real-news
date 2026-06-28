import { describe, expect, it } from 'vitest';
import { WhoOutbreaksSource } from '../../src/sources/who-outbreaks.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const RESPONSE = {
  value: [
    {
      Id: '32b088d3-994f-4813-842b-7decdcd1a3be',
      Title: 'Avian influenza – situation in Egypt',
      UrlName: '2026_03_20-en',
      PublicationDate: '2026-03-20T00:00:00Z',
      Overview:
        '<p><b>20 March 2026</b></p><p>The Ministry of Health in Egypt has confirmed the country&rsquo;s first human case of H5N1.</p>',
    },
    { Id: 'no-title', Title: '', UrlName: 'x', PublicationDate: '2026-01-01T00:00:00Z' },
  ],
};

describe('WhoOutbreaksSource', () => {
  it('maps an outbreak report to a Health RawItem with a stripped-HTML summary and item link', async () => {
    const fetcher: JsonFetcher = async (url) => {
      // Must request newest-first, else the API returns 2006 records (oldest-first default).
      expect(url).toContain('diseaseoutbreaknews');
      expect(decodeURIComponent(url)).toContain('$orderby=PublicationDate desc');
      return RESPONSE;
    };
    const source = new WhoOutbreaksSource({ fetchJson: fetcher, maxItems: 10 });

    const items = await source.extract();

    expect(items).toHaveLength(1); // empty-title item dropped
    expect(items[0]).toMatchObject({
      source: 'who-outbreaks',
      externalId: '32b088d3-994f-4813-842b-7decdcd1a3be',
      title: 'Avian influenza – situation in Egypt',
      url: 'https://www.who.int/emergencies/disease-outbreak-news/item/2026_03_20-en',
      metadata: { topic: 'Health' },
    });
    expect(items[0]?.text).toContain('Ministry of Health in Egypt');
    expect(items[0]?.text).not.toContain('<'); // HTML stripped
    expect(items[0]?.publishedAt).toBe(Date.parse('2026-03-20T00:00:00Z'));
  });

  it('respects maxItems and never throws in healthCheck on failure', async () => {
    const ok = new WhoOutbreaksSource({ fetchJson: async () => RESPONSE, maxItems: 0 });
    expect(await ok.extract()).toHaveLength(0);

    const broken = new WhoOutbreaksSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
