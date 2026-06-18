import { z } from 'zod';
import type { SignalSource } from './signal-source.js';
import type { JsonFetcher } from './http.js';
import type { Clock } from '../scheduler/clock.js';
import type { SignalObservation } from '../domain/types.js';

const BASE = 'https://api.worldbank.org/v2';

/** A (country, indicator) macro series to track. */
export interface WorldBankSeries {
  readonly country: string;
  readonly indicator: string;
}

/**
 * Default macro series — rate indicators (already %), so the swing between
 * consecutive years is a clean percentage-point volatility. GDP growth +
 * inflation for the US and the World aggregate.
 */
const DEFAULT_SERIES: readonly WorldBankSeries[] = [
  { country: 'US', indicator: 'FP.CPI.TOTL.ZG' }, // US inflation
  { country: 'US', indicator: 'NY.GDP.MKTP.KD.ZG' }, // US GDP growth
  { country: 'WLD', indicator: 'FP.CPI.TOTL.ZG' }, // World inflation
  { country: 'WLD', indicator: 'NY.GDP.MKTP.KD.ZG' }, // World GDP growth
];

/** [meta, data[]] tuple; data rows newest-first, recent years often null. */
const responseSchema = z.tuple([
  z.object({}).passthrough(),
  z
    .array(
      z.object({
        countryiso3code: z.string(),
        indicator: z.object({ id: z.string() }),
        date: z.string(),
        value: z.number().nullable(),
      }),
    )
    .nullable(),
]);

export interface WorldBankDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  readonly clock: Clock;
  readonly series?: readonly WorldBankSeries[];
}

/**
 * World Bank Open Data Signal source (ADR-0025). For each tracked macro series
 * it reads the recent annual values and emits **volatility** — the absolute
 * swing between the two most recent non-null readings — as a World/Business
 * scoring signal. Raw magnitudes (trillion-dollar GDP) would saturate the
 * signal, so we measure movement, not level. Never a Story.
 */
export class WorldBankSource implements SignalSource {
  readonly id = 'worldbank' as const;

  constructor(private readonly deps: WorldBankDeps) {}

  private get series(): readonly WorldBankSeries[] {
    return (this.deps.series ?? DEFAULT_SERIES).slice(0, this.deps.maxItems);
  }

  private url(s: WorldBankSeries): string {
    return `${BASE}/country/${s.country}/indicator/${s.indicator}?format=json&per_page=8`;
  }

  async healthCheck(): Promise<boolean> {
    const first = this.series[0];
    if (!first) return false;
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url(first))).success;
    } catch {
      return false;
    }
  }

  async observe(): Promise<SignalObservation[]> {
    const now = this.deps.clock.now();

    const results = await Promise.all(
      this.series.map(async (s): Promise<SignalObservation | null> => {
        const [, rows] = responseSchema.parse(await this.deps.fetchJson(this.url(s)));
        // Two most recent non-null readings (rows arrive newest-first).
        const recent = (rows ?? []).filter(
          (r): r is typeof r & { value: number } => r.value !== null,
        );
        const [latest, prior] = recent;
        if (!latest || !prior) return null; // need two points to measure a swing

        return {
          source: 'worldbank',
          region: 'World',
          topic: 'Business',
          key: `${latest.countryiso3code}:${latest.indicator.id}:${latest.date}`,
          value: Math.abs(latest.value - prior.value),
          observedAt: now,
        };
      }),
    );

    return results.filter((o): o is SignalObservation => o !== null);
  }
}
