import { z } from 'zod';
import type { SignalSource } from './signal-source.js';
import type { JsonFetcher } from './http.js';
import type { Clock } from '../scheduler/clock.js';
import type { SignalObservation, Topic } from '../domain/types.js';

const BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top';

// Wikimedia requires a descriptive User-Agent; omitting it can get the IP blocked.
const HEADERS = { 'user-agent': 'project-horizon (horizon@example.com)' };

/**
 * Wikipedia language editions we poll, and the Topic each informs (ADR-0025).
 * Hebrew attention maps to the `Israel` topic; the global English edition has no
 * single topic, so it nudges every story (`topic: null` ⇒ global bucket).
 */
const PROJECTS: readonly { project: string; topic: Topic | null }[] = [
  { project: 'en.wikipedia', topic: null },
  { project: 'he.wikipedia', topic: 'Israel' },
];

/** Main-page slugs across our projects — high-traffic noise, not a story signal. */
const MAIN_PAGES = new Set(['Main_Page', 'עמוד_ראשי']);

const responseSchema = z.object({
  items: z
    .array(
      z.object({
        articles: z
          .array(z.object({ article: z.string(), views: z.number() }))
          .optional(),
      }),
    )
    .optional(),
});

const pad = (n: number): string => String(n).padStart(2, '0');

export interface WikipediaPageviewsDeps {
  readonly fetchJson: JsonFetcher;
  readonly maxItems: number;
  readonly clock: Clock;
}

/**
 * Wikipedia Pageviews Signal source (ADR-0025). Reads each language edition's
 * most-viewed articles for the previous *complete* month (the current month is
 * still accruing) and emits them as attention observations — `he.wikipedia` ⇒
 * the `Israel` topic, `en.wikipedia` ⇒ a global nudge across all topics. Pure
 * attention volume, never a Story. A `User-Agent` is required by the API.
 */
export class WikipediaPageviewsSource implements SignalSource {
  readonly id = 'wikipedia-pageviews' as const;

  /** ~peak monthly views for a hot article — the attention-saturation scale (ADR-0031). */
  readonly saturationReference = 500_000;

  constructor(private readonly deps: WikipediaPageviewsDeps) {}

  /** Year/month of the previous complete month, from the Clock. */
  private period(): { year: number; month: number; yyyymm: string } {
    const d = new Date(this.deps.clock.now());
    // Day 0 of the current month rolls back to the last day of the prior month.
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    const year = prev.getUTCFullYear();
    const month = prev.getUTCMonth() + 1;
    return { year, month, yyyymm: `${year}${pad(month)}` };
  }

  private url(project: string): string {
    const { year, month } = this.period();
    return `${BASE}/${project}/all-access/${year}/${pad(month)}/all-days`;
  }

  async healthCheck(): Promise<boolean> {
    try {
      return responseSchema.safeParse(
        await this.deps.fetchJson(this.url(PROJECTS[0]!.project), { headers: HEADERS }),
      ).success;
    } catch {
      return false;
    }
  }

  async observe(): Promise<SignalObservation[]> {
    const now = this.deps.clock.now();
    const { yyyymm } = this.period();

    const perProject = await Promise.all(
      PROJECTS.map(async ({ project, topic }) => {
        const parsed = responseSchema.parse(
          await this.deps.fetchJson(this.url(project), { headers: HEADERS }),
        );
        const articles = parsed.items?.[0]?.articles ?? [];
        return articles
          .filter((a) => !a.article.includes(':') && !MAIN_PAGES.has(a.article))
          .slice(0, this.deps.maxItems)
          .map(
            (a): SignalObservation => ({
              source: 'wikipedia-pageviews',
              topic,
              key: `${project}:${a.article}:${yyyymm}`,
              value: a.views,
              observedAt: now,
            }),
          );
      }),
    );

    return perProject.flat();
  }
}
