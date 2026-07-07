import { describe, expect, it } from 'vitest';
import { FrankfurterSource } from '../../src/sources/frankfurter.js';
import type { JsonFetcher } from '../../src/sources/http.js';
import { FakeClock } from '../helpers/fake-clock.js';

const NOW = Date.UTC(2026, 5, 28, 9, 0, 0);

// Two most recent dates drive the swing; EUR moves +1% (0.88 → 0.8888), JPY flat.
const TIMESERIES = {
  base: 'USD',
  rates: {
    '2026-06-25': { EUR: 0.87, JPY: 161.0 },
    '2026-06-26': { EUR: 0.88, JPY: 161.5 },
    '2026-06-27': { EUR: 0.8888, JPY: 161.5 },
  },
};

describe('FrankfurterSource', () => {
  it('emits a Business FX-volatility signal per currency as the latest daily % move', async () => {
    const fetcher: JsonFetcher = async (url) => {
      expect(url).toContain('frankfurter');
      expect(url).toContain('base=USD');
      return TIMESERIES;
    };
    const source = new FrankfurterSource({
      fetchJson: fetcher,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });

    const obs = await source.observe();

    expect(obs.every((o) => o.source === 'frankfurter' && o.topic === 'Business')).toBe(true);
    const eur = obs.find((o) => o.key.includes('EUR'));
    expect(eur?.value).toBeCloseTo(1.0, 2); // (0.8888 - 0.88) / 0.88 * 100 ≈ 1%
    const jpy = obs.find((o) => o.key.includes('JPY'));
    expect(jpy?.value).toBeCloseTo(0, 5); // flat
    expect(obs[0]?.observedAt).toBe(NOW);
  });

  it('never emits a non-finite value when a rate overflows to Infinity (defense-in-depth)', async () => {
    // A JSON numeric literal beyond ±1.8e308 silently overflows to Infinity on
    // parse — `z.number()` accepts it, and (a - Infinity) / Infinity ⇒ NaN. That
    // NaN would hit signal_observations.value, a raw numeric DB bind rejected by
    // the store with an unrecoverable error — unlike a throwing Source, nothing
    // isolates it, so it would crash the whole tick (ADR-0025).
    const CORRUPT = {
      base: 'USD',
      rates: {
        '2026-06-26': { EUR: 1e309, JPY: 161.5 }, // overflows to Infinity
        '2026-06-27': { EUR: 0.88, JPY: 161.5 },
      },
    };
    const source = new FrankfurterSource({
      fetchJson: async () => CORRUPT,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });

    const obs = await source.observe();

    expect(obs.every((o) => Number.isFinite(o.value))).toBe(true);
    expect(obs.find((o) => o.key.includes('EUR'))).toBeUndefined(); // dropped, not NaN
    expect(obs.find((o) => o.key.includes('JPY'))).toBeDefined(); // unaffected pair survives
  });

  it('declares a saturation scale and never throws in healthCheck on failure', async () => {
    const source = new FrankfurterSource({
      fetchJson: async () => TIMESERIES,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });
    expect(source.saturationReference).toBeGreaterThan(0);

    const broken = new FrankfurterSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
      clock: new FakeClock(NOW),
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
