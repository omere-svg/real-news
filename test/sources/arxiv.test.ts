import { describe, expect, it } from 'vitest';
import { ArxivSource } from '../../src/sources/arxiv.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.01234v1</id>
    <title>A Study of
      Large Language Models</title>
    <summary>We study LLMs in depth.</summary>
    <published>2026-06-10T12:00:00Z</published>
    <link href="http://arxiv.org/abs/2401.01234v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`;

const fakeFetcher: JsonFetcher = async (_url, opts) => {
  if (opts?.as !== 'text') throw new Error('arxiv should request text');
  return ATOM;
};

describe('ArxivSource', () => {
  it('maps an Atom entry to a RawItem with AI/World metadata', async () => {
    const source = new ArxivSource({ fetchJson: fakeFetcher, maxItems: 10 });
    const [raw] = await source.extract();

    expect(raw?.source).toBe('arxiv');
    expect(raw?.externalId).toBe('2401.01234v1');
    expect(raw?.title).toBe('A Study of Large Language Models'); // whitespace collapsed
    expect(raw?.url).toBe('http://arxiv.org/abs/2401.01234v1');
    expect(raw?.text).toBe('We study LLMs in depth.');
    expect(raw?.publishedAt).toBe(Date.parse('2026-06-10T12:00:00Z'));
    expect(raw?.metadata.topic).toBe('AI');
  });

  it('healthCheck returns false (never throws) on fetch failure', async () => {
    const source = new ArxivSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
    });
    await expect(source.healthCheck()).resolves.toBe(false);
  });
});
