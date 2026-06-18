import { describe, expect, it } from 'vitest';
import { WorldBankSource } from '../../src/sources/worldbank.js';
import { FakeClock } from '../helpers/fake-clock.js';
import type { JsonFetcher } from '../../src/sources/http.js';

const NOW = Date.parse('2026-06-18T10:00:00Z');

/** World Bank returns [meta, data[]] with data newest-first; recent years may be null. */
function series(iso3: string, indicator: string, rows: { date: string; value: number | null }[]) {
  return [
    { page: 1, pages: 1, per_page: 100, total: rows.length },
    rows.map((r) => ({
      indicator: { id: indicator, value: indicator },
      country: { id: iso3.slice(0, 2), value: iso3 },
      countryiso3code: iso3,
      date: r.date,
      value: r.value,
    })),
  ];
}

const INFLATION = series('USA', 'FP.CPI.TOTL.ZG', [
  { date: '2025', value: null }, // not yet released
  { date: '2024', value: 2.9 },
  { date: '2023', value: 4.1 },
  { date: '2022', value: 8.0 },
]);

describe('WorldBankSource', () => {
  it('emits macro volatility (swing between the two most recent non-null values)', async () => {
    let requested = '';
    const fetchJson: JsonFetcher = async (url) => {
      requested = url;
      return INFLATION;
    };
    const source = new WorldBankSource({
      fetchJson,
      maxItems: 50,
      clock: new FakeClock(NOW),
      series: [{ country: 'US', indicator: 'FP.CPI.TOTL.ZG' }],
    });

    const [obs] = await source.observe();

    expect(requested).toContain('/country/US/indicator/FP.CPI.TOTL.ZG');
    expect(requested).toContain('format=json');
    expect(obs).toMatchObject({
      source: 'worldbank',
      region: 'World',
      topic: 'Business',
      observedAt: NOW,
    });
    // |2.9 - 4.1| = 1.2 percentage-point swing; keyed by the latest non-null year.
    expect(obs?.value).toBeCloseTo(1.2, 5);
    expect(obs?.key).toBe('USA:FP.CPI.TOTL.ZG:2024');
  });

  it('skips a series with fewer than two non-null readings (no change to measure)', async () => {
    const sparse = series('USA', 'FP.CPI.TOTL.ZG', [
      { date: '2025', value: null },
      { date: '2024', value: 2.9 },
    ]);
    const source = new WorldBankSource({
      fetchJson: async () => sparse,
      maxItems: 50,
      clock: new FakeClock(NOW),
      series: [{ country: 'US', indicator: 'FP.CPI.TOTL.ZG' }],
    });

    expect(await source.observe()).toHaveLength(0);
  });

  it('healthCheck is true on a parseable response, false on failure', async () => {
    const ok = new WorldBankSource({
      fetchJson: async () => INFLATION,
      maxItems: 50,
      clock: new FakeClock(NOW),
      series: [{ country: 'US', indicator: 'FP.CPI.TOTL.ZG' }],
    });
    expect(await ok.healthCheck()).toBe(true);

    const bad = new WorldBankSource({
      fetchJson: async () => {
        throw new Error('cloudflare 5xx');
      },
      maxItems: 50,
      clock: new FakeClock(NOW),
      series: [{ country: 'US', indicator: 'FP.CPI.TOTL.ZG' }],
    });
    expect(await bad.healthCheck()).toBe(false);
  });
});
