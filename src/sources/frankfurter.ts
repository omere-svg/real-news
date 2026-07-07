import { z } from 'zod';
import type { SignalSource } from './signal-source.js';
import type { JsonFetcher } from './http.js';
import type { Clock } from '../scheduler/clock.js';
import type { SignalObservation } from '../domain/types.js';

// Keyless ECB-derived FX (frankfurter.app moved to frankfurter.dev/v1).
const BASE = 'https://api.frankfurter.dev/v1';

/** Major pairs vs USD — ECB publishes these; ILS is not in the ECB set. */
const DEFAULT_SYMBOLS = ['EUR', 'GBP', 'JPY'] as const;

const responseSchema = z.object({
  rates: z.record(z.string(), z.record(z.string(), z.number())),
});

const pad = (n: number): string => String(n).padStart(2, '0');
const isoDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export interface FrankfurterDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  readonly clock: Clock;
  readonly symbols?: readonly string[];
}

/**
 * Frankfurter FX Signal source (ADR-0031). Reads a short recent window for the
 * major USD pairs and emits the **absolute daily % move** of each as a `Business`
 * volatility signal — an FX shock nudges Business significance, never a Story.
 * Movement, not level (like World Bank). Keyless, ECB-derived.
 */
export class FrankfurterSource implements SignalSource {
  readonly id = 'frankfurter' as const;

  /** A ~2% single-day FX move is a strong shock — the saturation scale (ADR-0031). */
  readonly saturationReference = 2;

  constructor(private readonly deps: FrankfurterDeps) {}

  private get symbols(): readonly string[] {
    return this.deps.symbols ?? DEFAULT_SYMBOLS;
  }

  private url(): string {
    // ~8-day window guarantees at least two trading days to measure a swing.
    const start = isoDay(this.deps.clock.now() - 8 * 86_400_000);
    return `${BASE}/${start}..?base=USD&symbols=${this.symbols.join(',')}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(await this.deps.fetchJson(this.url())).success;
    } catch {
      return false;
    }
  }

  async observe(): Promise<SignalObservation[]> {
    const now = this.deps.clock.now();
    const { rates } = responseSchema.parse(await this.deps.fetchJson(this.url()));

    const dates = Object.keys(rates).sort(); // ascending ISO dates
    const latestDate = dates[dates.length - 1];
    const priorDate = dates[dates.length - 2];
    if (!latestDate || !priorDate) return []; // need two days to measure a swing

    const latest = rates[latestDate] ?? {};
    const prior = rates[priorDate] ?? {};

    return this.symbols
      .map((cur): SignalObservation | null => {
        const a = latest[cur];
        const b = prior[cur];
        if (typeof a !== 'number' || typeof b !== 'number' || b === 0) return null;
        const pct = Math.abs((a - b) / b) * 100;
        // Defense-in-depth: `z.number()` accepts Infinity, and a JSON numeric
        // literal beyond ±1.8e308 (a malformed/corrupt upstream rate) silently
        // overflows to Infinity on parse — turning this into NaN/Infinity math.
        // `value` is a raw numeric DB bind (signal_observations), not JSON; a
        // non-finite bind is rejected by the store with a hard error that isn't
        // isolated the way a throwing Source is, so it would crash the whole
        // tick instead of just this one reading (ADR-0025).
        if (!Number.isFinite(pct)) return null;
        return {
          source: 'frankfurter',
          topic: 'Business',
          key: `frankfurter:USD${cur}:${latestDate}`,
          value: pct,
          observedAt: now,
        };
      })
      .filter((o): o is SignalObservation => o !== null);
  }
}
