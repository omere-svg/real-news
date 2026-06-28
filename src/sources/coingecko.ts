import { z } from 'zod';
import type { SignalSource } from './signal-source.js';
import type { JsonFetcher } from './http.js';
import type { Clock } from '../scheduler/clock.js';
import type { SignalObservation } from '../domain/types.js';

// Keyless public market data. ToS: attribution "Data provided by CoinGecko" required in the UI.
const BASE = 'https://api.coingecko.com/api/v3/coins/markets';

const coinSchema = z.object({
  id: z.string(),
  price_change_percentage_24h: z.number().nullable().optional(),
});
const responseSchema = z.array(coinSchema);

const pad = (n: number): string => String(n).padStart(2, '0');

export interface CoinGeckoDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  readonly clock: Clock;
}

/**
 * CoinGecko Signal source (ADR-0031). Emits the **absolute 24h price move** of
 * the top coins by market cap as a `Business` momentum signal — a sharp crypto
 * swing nudges Business-topic significance, never a standalone Story. Movement,
 * not level (a six-figure BTC price would saturate). Attribution required.
 */
export class CoinGeckoSource implements SignalSource {
  readonly id = 'coingecko' as const;

  /** A ~20% daily move is an extreme crypto swing — the saturation scale (ADR-0031). */
  readonly saturationReference = 20;

  constructor(private readonly deps: CoinGeckoDeps) {}

  private url(perPage: number): string {
    return (
      `${BASE}?vs_currency=usd&order=market_cap_desc` +
      `&per_page=${perPage}&page=1&price_change_percentage=24h`
    );
  }

  /** UTC day stamp — keeps each tick's observation keys stable within the day. */
  private day(): string {
    const d = new Date(this.deps.clock.now());
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url(1))).success;
    } catch {
      return false;
    }
  }

  async observe(): Promise<SignalObservation[]> {
    const now = this.deps.clock.now();
    const day = this.day();
    const coins = responseSchema.parse(
      await this.deps.fetchJson(this.url(this.deps.maxItems)),
    );

    return coins
      .filter((c): c is { id: string; price_change_percentage_24h: number } =>
        typeof c.price_change_percentage_24h === 'number',
      )
      .map((c) => ({
        source: 'coingecko' as const,
        topic: 'Business' as const,
        key: `coingecko:${c.id}:${day}`,
        value: Math.abs(c.price_change_percentage_24h),
        observedAt: now,
      }));
  }
}
