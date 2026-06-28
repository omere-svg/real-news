import { z } from 'zod';
import type { SignalSource } from './signal-source.js';
import type { JsonFetcher } from './http.js';
import type { Clock } from '../scheduler/clock.js';
import type { SignalObservation } from '../domain/types.js';

// Keyless; `mailto` opts into the faster, more reliable polite pool.
const BASE = 'https://api.openalex.org/works';
const MAILTO = 'horizon@example.com';

/** How far back counts as "recent research" for the impact window. */
const RECENT_DAYS = 90;

const workSchema = z.object({
  id: z.string(),
  cited_by_count: z.number().nullable().optional(),
});
const responseSchema = z.object({ results: z.array(workSchema).optional() });

const pad = (n: number): string => String(n).padStart(2, '0');
const isoDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export interface OpenAlexDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  readonly clock: Clock;
}

/**
 * OpenAlex Signal source (ADR-0031). Reads the most-cited *recent* works and
 * emits their citation counts as a `Science` impact signal — a recent paper
 * accruing citations fast nudges Science significance, never a Story. Complements
 * arXiv (a firehose with no impact ranking). Peak salience wins, so the signal
 * tracks the single most-cited recent work.
 */
export class OpenAlexSource implements SignalSource {
  readonly id = 'openalex' as const;

  /** ~50 citations on a <90-day-old work is exceptional — the saturation scale (ADR-0031). */
  readonly saturationReference = 50;

  constructor(private readonly deps: OpenAlexDeps) {}

  private url(perPage: number): string {
    const since = isoDay(this.deps.clock.now() - RECENT_DAYS * 86_400_000);
    return (
      `${BASE}?filter=from_publication_date:${since}` +
      `&sort=cited_by_count:desc&per_page=${perPage}&mailto=${MAILTO}`
    );
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
    const { results } = responseSchema.parse(
      await this.deps.fetchJson(this.url(this.deps.maxItems)),
    );

    return (results ?? [])
      .filter((w): w is { id: string; cited_by_count: number } =>
        typeof w.cited_by_count === 'number' && w.cited_by_count > 0,
      )
      .map((w) => ({
        source: 'openalex' as const,
        topic: 'Science' as const,
        key: `openalex:${w.id}`,
        value: w.cited_by_count,
        observedAt: now,
      }));
  }
}
