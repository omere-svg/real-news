import { describe, expect, it } from 'vitest';
import { PsyArxivSource } from '../../src/sources/psyarxiv.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const FEED = {
  data: [
    {
      id: 'wpt5b',
      attributes: {
        title: 'Learning social preferences',
        description: 'A psychology preprint abstract.',
        date_published: '2026-06-16T13:29:19.436799',
      },
      links: { html: 'https://osf.io/preprints/psyarxiv/wpt5b/' },
    },
    { id: 'noattrs', attributes: { title: '' }, links: {} }, // no title → dropped
  ],
};

const fetcher: JsonFetcher = async () => FEED;

describe('PsyArxivSource', () => {
  it('maps an OSF preprint to a RawItem with Science/World metadata', async () => {
    const source = new PsyArxivSource({ fetchJson: fetcher, maxItems: 10 });
    const items = await source.extract();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: 'psyarxiv',
      externalId: 'wpt5b',
      title: 'Learning social preferences',
      url: 'https://osf.io/preprints/psyarxiv/wpt5b/',
      text: 'A psychology preprint abstract.',
      metadata: { region: 'World', topic: 'Science' },
    });
    expect(items[0]?.publishedAt).toBe(Date.parse('2026-06-16T13:29:19.436799'));
  });

  it('healthCheck never throws on failure', async () => {
    const broken = new PsyArxivSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
