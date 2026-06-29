import { Hono } from 'hono';
import type { Context } from 'hono';
import type { StoryQuery, StoryRepo } from '../db/story-repo.js';
import type { TickReportRepo } from '../db/tick-report-repo.js';
import type { Topic } from '../domain/types.js';
import type { BriefRequest, QueryEngine } from '../presentation/query-engine.js';
import { normalizeMinutes } from '../presentation/minutes.js';
import { renderUI, renderDashboard } from './ui.js';

/**
 * The read-only presentation server (ADR-0011, Principle 4). Serves the
 * pre-compiled Story cache — never makes real-time external calls. A thin HTTP
 * surface over StoryRepo.topStories (plain list) and the QueryEngine (brief /
 * outline / podcast, ADR-0014), plus the single-page viewer.
 */

/** Default attention budget + preferences applied when the request omits them. */
export interface PresentationDefaults {
  readonly minutes: number;
  readonly topics?: readonly Topic[];
}

/** Web-surface hardening knobs (ADR-0023). */
export interface WebOptions {
  /** Hard cap on requested minutes (cost-amplification guard). */
  readonly maxMinutes: number;
  /** Tighter cap for the podcast (TTS) path. */
  readonly maxPodcastMinutes: number;
  /** Expose the LLM-backed /api/podcast endpoint. Off by default. */
  readonly podcastEnabled: boolean;
}

export function createApp(
  storyRepo: StoryRepo,
  queryEngine: QueryEngine,
  defaults: PresentationDefaults,
  web: WebOptions,
  /** Observability log (ADR-0033); when omitted the dashboard/feed return empty. */
  tickReports?: TickReportRepo,
): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  // Observability (ADR-0033): recent tick outcomes as JSON + an HTML dashboard.
  app.get('/api/ticks', async (c) => {
    const limit = normalizeLimit(c.req.query('limit'), 50);
    return c.json({ ticks: tickReports ? await tickReports.recent(limit) : [] });
  });

  app.get('/dashboard', async (c) =>
    c.html(renderDashboard(tickReports ? await tickReports.recent(50) : [])),
  );

  app.get('/api/stories', async (c) => {
    const q = c.req.query();
    const topics = c.req.queries('topic') as Topic[] | undefined;
    const query: StoryQuery = {
      limit: q.limit ? Number(q.limit) : 50,
      ...(topics?.length ? { topic: topics } : {}),
      ...(q.minSignificance
        ? { minSignificance: Number(q.minSignificance) }
        : {}),
    };
    return c.json({ stories: await storyRepo.topStories(query) });
  });

  app.get('/api/brief', async (c) => {
    return c.json({ brief: await queryEngine.textBrief(briefRequestOf(c, defaults, web)) });
  });

  app.get('/api/podcast', async (c) => {
    // LLM-backed cost vector — off by default (ADR-0023). Telegram is the audited surface.
    if (!web.podcastEnabled) return c.json({ error: 'not found' }, 404);
    // Podcasts get the tighter audio cap, not the general maxMinutes.
    const podcastWeb = { ...web, maxMinutes: Math.min(web.maxMinutes, web.maxPodcastMinutes) };
    return c.json({ script: await queryEngine.podcastScript(briefRequestOf(c, defaults, podcastWeb)) });
  });

  app.get('/api/outline', async (c) => {
    const topic = (c.req.query('topic') ?? defaults.topics?.[0]) as Topic | undefined;
    if (!topic) return c.json({ error: 'topic is required' }, 400);
    return c.json({ outline: await queryEngine.topicOutline(topic, briefRequestOf(c, defaults, web)) });
  });

  app.get('/', (c) =>
    c.html(
      renderUI({
        minutes: defaults.minutes,
        ...(defaults.topics?.length ? { topics: defaults.topics } : {}),
      }),
    ),
  );

  return app;
}

/** A positive limit clamped to [1, 200]; falls back to `fallback` for bad input. */
function normalizeLimit(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(200, Math.floor(n));
}

/** Build a BriefRequest from query params, falling back to defaults, clamping minutes. */
function briefRequestOf(
  c: Context,
  defaults: PresentationDefaults,
  web: WebOptions,
): BriefRequest {
  const minutesParam = c.req.query('minutes');
  const topics = c.req.queries('topic') as Topic[] | undefined;
  return {
    minutes: normalizeMinutes(
      minutesParam ? Number(minutesParam) : defaults.minutes,
      web.maxMinutes,
    ),
    ...(topics?.length
      ? { topics }
      : defaults.topics
        ? { topics: defaults.topics }
        : {}),
  };
}
