import { z } from 'zod';
import { parseDateOrNull } from './date.js';
import type { SourceAdapter } from './source-adapter.js';
import type { JsonFetcher } from './http.js';
import type { Clock } from '../scheduler/clock.js';
import type { RawItem } from '../domain/types.js';

// Free tier uses the demo key `3` in the path; no signup, caching permitted by ToS.
const BASE = 'https://www.thesportsdb.com/api/v1/json/3';

/** Sports polled by default — the highest-volume global leagues. */
const DEFAULT_SPORTS = ['Soccer', 'Basketball'] as const;

const eventSchema = z.object({
  idEvent: z.string(),
  strEvent: z.string().nullable().optional(),
  strLeague: z.string().nullable().optional(),
  strHomeTeam: z.string().nullable().optional(),
  strAwayTeam: z.string().nullable().optional(),
  intHomeScore: z.string().nullable().optional(),
  intAwayScore: z.string().nullable().optional(),
  strStatus: z.string().nullable().optional(),
  strTimestamp: z.string().nullable().optional(),
});
type Event = z.infer<typeof eventSchema>;

// Drop entries missing the dedup key before validating the rest.
const responseSchema = z.object({
  events: z.array(z.unknown()).nullable().optional(),
});

const pad = (n: number): string => String(n).padStart(2, '0');

export interface TheSportsDbDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  readonly clock: Clock;
  readonly sports?: readonly string[];
}

/**
 * TheSportsDB adapter (ADR-0031) — opens the `Sports` Topic, which had no source.
 * Reads the previous UTC day's finished events for each tracked sport (the free
 * keyless demo endpoint), one RawItem per match. Topic=Sports skips the classifier
 * (ADR-0009). No engagement fields on the free tier, so it is STORY-only — no
 * scoring signals; significance comes from recency + corroboration.
 */
export class TheSportsDbSource implements SourceAdapter {
  readonly id = 'thesportsdb' as const;

  constructor(private readonly deps: TheSportsDbDeps) {}

  private get sports(): readonly string[] {
    return this.deps.sports ?? DEFAULT_SPORTS;
  }

  /** The previous complete UTC day — finished matches, not today's fixtures. */
  private yesterday(): string {
    const d = new Date(this.deps.clock.now());
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
    return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
  }

  private url(sport: string): string {
    return `${BASE}/eventsday.php?d=${this.yesterday()}&s=${encodeURIComponent(sport)}`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const first = this.sports[0];
      if (!first) return false;
      return responseSchema.safeParse(await this.deps.fetchJson(this.url(first))).success;
    } catch {
      return false;
    }
  }

  async extract(): Promise<RawItem[]> {
    const perSport = await Promise.all(
      this.sports.map(async (sport) => {
        const parsed = responseSchema.parse(await this.deps.fetchJson(this.url(sport)));
        return (parsed.events ?? [])
          .map((e) => eventSchema.safeParse(e))
          .filter((r): r is { success: true; data: Event } => r.success)
          .map((r) => this.toRawItem(r.data));
      }),
    );

    // Round-robin across sports so the cap doesn't starve later sports: a normal
    // day has >maxItems soccer matches, and a flat().slice() would truncate
    // basketball to zero every tick (ADR-0049).
    return interleave(perSport).slice(0, this.deps.maxItems);
  }

  private toRawItem(e: Event): RawItem {
    const title = e.strEvent?.trim() || `${e.strHomeTeam} vs ${e.strAwayTeam}`;
    return {
      source: 'thesportsdb',
      externalId: e.idEvent,
      title,
      url: null, // no canonical event page on the free tier
      text: scoreLine(e),
      publishedAt: parseDateOrNull(e.strTimestamp),
      metadata: { topic: 'Sports' },
    };
  }
}

/** Flatten per-group arrays round-robin (one from each group per pass), so a cap
 * applied afterward represents every group instead of exhausting the first. */
function interleave<T>(groups: readonly T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i += 1) {
    for (const g of groups) {
      const item = g[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

/** A deterministic "what happened": final score + league, when present. */
function scoreLine(e: Event): string | null {
  const league = e.strLeague?.trim();
  const hasScore = e.intHomeScore != null && e.intAwayScore != null;
  if (hasScore) {
    const line = `${e.strHomeTeam} ${e.intHomeScore}–${e.intAwayScore} ${e.strAwayTeam}`;
    return league ? `${line} · ${league}` : line;
  }
  return league ?? null;
}
