import { describe, expect, it } from 'vitest';
import { CoinGeckoSource } from '../../src/sources/coingecko.js';
import type { JsonFetcher } from '../../src/sources/http.js';
import { FakeClock } from '../helpers/fake-clock.js';

const NOW = Date.UTC(2026, 5, 28, 9, 0, 0);

const MARKETS = [
  { id: 'bitcoin', symbol: 'btc', price_change_percentage_24h: -0.54 },
  { id: 'ethereum', symbol: 'eth', price_change_percentage_24h: 8.2 },
  { id: 'stablecoin', symbol: 'usdt', price_change_percentage_24h: null }, // dropped
];

describe('CoinGeckoSource', () => {
  it('emits a Business momentum signal per coin as the absolute 24h move', async () => {
    const fetcher: JsonFetcher = async (url) => {
      expect(url).toContain('coins/markets');
      return MARKETS;
    };
    const source = new CoinGeckoSource({
      fetchJson: fetcher,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });

    const obs = await source.observe();

    expect(obs).toHaveLength(2); // null-change coin dropped
    expect(obs.every((o) => o.source === 'coingecko' && o.topic === 'Business')).toBe(true);
    const eth = obs.find((o) => o.key.includes('ethereum'));
    expect(eth?.value).toBeCloseTo(8.2, 5); // absolute move
    const btc = obs.find((o) => o.key.includes('bitcoin'));
    expect(btc?.value).toBeCloseTo(0.54, 5); // sign dropped
    expect(obs[0]?.observedAt).toBe(NOW);
  });

  it('declares a saturation scale and never throws in healthCheck on failure', async () => {
    const source = new CoinGeckoSource({
      fetchJson: async () => MARKETS,
      maxItems: 10,
      clock: new FakeClock(NOW),
    });
    expect(source.saturationReference).toBeGreaterThan(0);

    const broken = new CoinGeckoSource({
      fetchJson: async () => {
        throw new Error('down');
      },
      maxItems: 10,
      clock: new FakeClock(NOW),
    });
    await expect(broken.healthCheck()).resolves.toBe(false);
  });
});
