import { describe, expect, it } from 'vitest';
import { SecEdgarSource } from '../../src/sources/sec-edgar.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const HITS = {
  hits: {
    hits: [
      {
        _id: '0001185185-13-002042:ex2-1.htm',
        _source: {
          display_names: ['Globex Corp.  (GLBX)  (CIK 0001185185)'],
          form: '8-K',
          file_date: '2026-06-11',
          ciks: ['0001185185'],
        },
      },
    ],
  },
};

describe('SecEdgarSource', () => {
  it('sends a User-Agent and maps a filing to a Business/World RawItem', async () => {
    let sawUserAgent = false;
    const fetchJson: JsonFetcher = async (_url, opts) => {
      if (opts?.headers?.['user-agent']) sawUserAgent = true;
      return HITS;
    };

    const [raw] = await new SecEdgarSource({ fetchJson, maxItems: 10 }).extract();

    expect(sawUserAgent).toBe(true); // SEC requires it
    expect(raw?.source).toBe('secedgar');
    expect(raw?.externalId).toBe('0001185185-13-002042:ex2-1.htm');
    expect(raw?.title).toContain('Globex Corp.');
    expect(raw?.title).toContain('8-K');
    expect(raw?.title).toContain('2026-06-11'); // date disambiguates distinct filings
    expect(raw?.text).toContain('accession 0001185185-13-002042'); // accession in text
    expect(raw?.url).toContain('/Archives/edgar/data/');
    expect(raw?.publishedAt).toBe(Date.parse('2026-06-11'));
    expect(raw?.metadata.topic).toBe('Business');
  });

  it('healthCheck returns false (never throws) on failure', async () => {
    const s = new SecEdgarSource({
      fetchJson: async () => {
        throw new Error('403');
      },
      maxItems: 10,
    });
    await expect(s.healthCheck()).resolves.toBe(false);
  });

  it('bounds the query to a recent date window when a clock is given (ADR-0049)', async () => {
    let seenUrl = '';
    const fetchJson: JsonFetcher = async (url) => {
      seenUrl = url;
      return HITS;
    };
    const now = Date.parse('2026-07-07T00:00:00Z');
    await new SecEdgarSource({
      fetchJson,
      maxItems: 10,
      clock: { now: () => now },
    }).extract();
    expect(seenUrl).toContain('enddt=2026-07-07');
    expect(seenUrl).toContain('startdt=2026-06-23'); // 14 days back
  });
});
