import { Hono } from 'hono';
import type { StoryQuery, StoryRepo } from '../db/story-repo.js';
import type { Region, Topic } from '../domain/types.js';
import { UI_HTML } from './ui.js';

/**
 * The read-only presentation server (ADR-0011, Principle 4). Serves the
 * pre-compiled Story cache — never makes real-time external calls. A thin HTTP
 * surface over StoryRepo.topStories plus the single-page viewer.
 */
export function createApp(storyRepo: StoryRepo): Hono {
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

  app.get('/', (c) => c.html(UI_HTML));

  return app;
}
