import { z } from 'zod';
import type { SignalSource } from './signal-source.js';
import type { JsonFetcher } from './http.js';
import type { SignalObservation } from '../domain/types.js';

const BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';
const DEFAULT_QUERY =
  '(geopolitics OR diplomacy OR conflict OR sanctions OR war OR election)';

/**
 * GDELT is legitimately slow and the timeline endpoints are heavier than a
 * plain artlist; give it a generous per-request timeout (mirrors GdeltSource,
 * ADR-0039). One call per tick keeps well under GDELT's ~1-req/5s limit.
 */
const GDELT_TIMEOUT_MS = 25_000;

const responseSchema = z.object({
  timeline: z
    .array(
      z.object({
        data: z
          .array(z.object({ date: z.string(), value: z.number() }))
          .optional(),
      }),
    )
    .optional(),
});

export interface GdeltSignalDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  /** GDELT query (defaults to a broad geopolitics/world query). */
  readonly query?: string;
  /** Timespan window for the tone average (GDELT syntax, e.g. `1d`). */
  readonly timespan?: string;
  readonly timeoutMs?: number;
}

/**
 * GDELT aggregate-tone Signal source (ADR-0041). GDELT's `artlist` endpoint the
 * Story adapter uses exposes no per-article tone/mentions (ADR-0032 note), so
 * this sibling reads the `timelinetone` endpoint instead — the *average tone* of
 * world coverage matching a geopolitics query — and emits its **negativity** as
 * a bounded `Geopolitics` intensity signal. A sharply negative news climate
 * (conflict, disaster, crisis) nudges Geopolitics significance; a calm/positive
 * climate is neutral, never a penalty. Numeric only — never a Story.
 *
 * Like `GdeltSource`, `healthCheck` makes no probe: a probe followed immediately
 * by `observe` would be two calls back-to-back and trip GDELT's rate limit
 * (ADR-0039). The pipeline's try/catch still isolates a genuinely-down GDELT.
 */
export class GdeltSignalSource implements SignalSource {
  readonly id = 'gdelt-signal' as const;

  /** A ~ -6 average tone is an extreme, crisis-level news climate (ADR-0041). */
  readonly saturationReference = 6;

  constructor(private readonly deps: GdeltSignalDeps) {}

  private url(): string {
    const query = encodeURIComponent(this.deps.query ?? DEFAULT_QUERY);
    const timespan = this.deps.timespan ?? '1d';
    return `${BASE}?query=${query}&mode=timelinetone&format=json&timespan=${timespan}`;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async observe(): Promise<SignalObservation[]> {
    const now = Date.now();
    const parsed = responseSchema.parse(
      await this.deps.fetchJson(this.url(), {
        timeoutMs: this.deps.timeoutMs ?? GDELT_TIMEOUT_MS,
      }),
    );

    const points = parsed.timeline?.[0]?.data ?? [];
    const latest = points[points.length - 1];
    if (!latest) return [];

    // Negativity only: a negative average tone signals a bad-news climate; a
    // neutral/positive climate yields ~0 (positive-only nudge, ADR-0025).
    const negativity = Math.max(0, -latest.value);

    return [
      {
        source: 'gdelt-signal',
        topic: 'Geopolitics',
        key: `gdelt-signal:tone:${latest.date}`,
        value: negativity,
        observedAt: now,
      },
    ];
  }
}
