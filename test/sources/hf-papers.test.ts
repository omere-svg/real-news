import { describe, expect, it } from 'vitest';
import { HfPapersSource } from '../../src/sources/hf-papers.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const FEED = [
  {
    numComments: 4,
    paper: {
      id: '2606.17081',
      title: 'A trending AI paper',
      summary: 'Raw abstract.',
      ai_summary: 'A crisp AI-written summary.',
      upvotes: 42,
      publishedAt: '2026-06-11T00:00:00.000Z',
    },
  },
  { paper: { title: 'missing id — dropped' } },
];

const fetcher: JsonFetcher = async () => FEED;

describe('HfPapersSource', () => {
  it('maps a daily paper to a RawItem with AI/World + popularity signals', async () => {
    const source = new HfPapersSource({ fetchJson: fetcher, maxItems: 10 });
    const items = await source.extract();

    expect(items).toHaveLength(1); // id-less paper dropped
    expect(items[0]).toMatchObject({
      source: 'hf-papers',
      externalId: '2606.17081',
      title: 'A trending AI paper',
      url: 'https://huggingface.co/papers/2606.17081',
      text: 'A crisp AI-written summary.', // prefers ai_summary
      metadata: { topic: 'AI', points: 42, mentions: 4 },
    });
    expect(items[0]?.publishedAt).toBe(Date.parse('2026-06-11T00:00:00.000Z'));
  });

  it('respects maxItems and never throws in healthCheck on failure', async () => {
    const ok = new HfPapersSource({ fetchJson: fetcher, maxItems: 0 });
    expect(await ok.extract()).toHaveLength(0);

    const broken = new HfPapersSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
