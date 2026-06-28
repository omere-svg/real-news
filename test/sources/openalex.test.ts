import { describe, expect, it } from 'vitest';
import { OpenAlexSource } from '../../src/sources/openalex.js';
import type { JsonFetcher } from '../../src/sources/http.js';
import { FakeClock } from '../helpers/fake-clock.js';

const NOW = Date.UTC(2026, 5, 28, 9, 0, 0);

const RESPONSE = {
  results: [
    { id: 'https://openalex.org/W123', cited_by_count: 80 },
    { id: 'https://openalex.org/W456', cited_by_count: 5 },
    { id: 'https://openalex.org/W789' }, // no count → 0, dropped
  ],
};

describe('OpenAlexSource', () => {
  it('emits a Science citation-impact signal per recent work', async () => {
    const fetcher: JsonFetcher = async (url) => {
      expect(url).toContain('openalex.org/works');
      expect(url).toContain('from_publication_date:'); // recent window
      expect(url).toContain('cited_by_count:desc');
      return RESPONSE;
    };
    const source = new OpenAlexSource({
      fetchJson: fetcher,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });

    const obs = await source.observe();

    expect(obs).toHaveLength(2); // count-less work dropped
    expect(obs.every((o) => o.source === 'openalex' && o.topic === 'Science')).toBe(true);
    expect(obs.find((o) => o.key.includes('W123'))?.value).toBe(80);
    expect(obs[0]?.observedAt).toBe(NOW);
  });

  it('declares a saturation scale and never throws in healthCheck on failure', async () => {
    const source = new OpenAlexSource({
      fetchJson: async () => RESPONSE,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });
    expect(source.saturationReference).toBeGreaterThan(0);

    const broken = new OpenAlexSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
      clock: new FakeClock(NOW),
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
