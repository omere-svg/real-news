import { Hono } from 'hono';
import type { Context } from 'hono';
import type { StoryQuery, StoryRepo } from '../db/story-repo.js';
import type { Region, Topic } from '../domain/types.js';
import type { BriefRequest, QueryEngine } from '../presentation/query-engine.js';
import { renderUI } from './ui.js';

/**
 * The read-only presentation server (ADR-0011, Principle 4). Serves the
 * pre-compiled Story cache — never makes real-time external calls. A thin HTTP
 * surface over StoryRepo.topStories (plain list) and the QueryEngine (brief /
 * outline / podcast, ADR-0014), plus the single-page viewer.
 */

/** Default attention budget + preferences applied when the request omits them. */
export interface PresentationDefaults {
  readonly minutes: number;
  readonly regions?: readonly Region[];
  readonly topics?: readonly Topic[];
}

export function createApp(
  storyRepo: StoryRepo,
  queryEngine: QueryEngine,
  defaults: PresentationDefaults,
): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/api/stories', async (c) => {
    const q = c.req.query();
    const query: StoryQuery = {
      limit: q.limit ? Number(q.limit) : 50,
      ...(q.region ? { region: q.region as Region } : {}),
      ...(q.topic ? { topic: q.topic as Topic } : {}),
      ...(q.minSignificance
        ? { minSignificance: Number(q.minSignificance) }
        : {}),
    };
    return c.json({ stories: await storyRepo.topStories(query) });
  });

  app.get('/api/brief', async (c) => {
    return c.json({ brief: await queryEngine.textBrief(briefRequestOf(c, defaults)) });
  });

  app.get('/api/podcast', async (c) => {
    return c.json({ script: await queryEngine.podcastScript(briefRequestOf(c, defaults)) });
  });

  app.get('/api/outline', async (c) => {
    const topic = (c.req.query('topic') ?? defaults.topics?.[0]) as Topic | undefined;
    if (!topic) return c.json({ error: 'topic is required' }, 400);
    return c.json({ outline: await queryEngine.topicOutline(topic, briefRequestOf(c, defaults)) });
  });

  app.get('/', (c) =>
    c.html(
      renderUI({
        minutes: defaults.minutes,
        ...(defaults.regions?.length === 1 ? { region: defaults.regions[0] } : {}),
        ...(defaults.topics?.length === 1 ? { topic: defaults.topics[0] } : {}),
      }),
    ),
  );

  return app;
}

/** Build a BriefRequest from query params, falling back to the configured defaults. */
function briefRequestOf(c: Context, defaults: PresentationDefaults): BriefRequest {
  const minutesParam = c.req.query('minutes');
  const regions = c.req.queries('region') as Region[] | undefined;
  const topics = c.req.queries('topic') as Topic[] | undefined;
  return {
    minutes: minutesParam ? Number(minutesParam) : defaults.minutes,
    ...(regions?.length
      ? { regions }
      : defaults.regions
        ? { regions: defaults.regions }
        : {}),
    ...(topics?.length
      ? { topics }
      : defaults.topics
        ? { topics: defaults.topics }
        : {}),
  };
}
