import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';

async function appWithStories() {
  const db = await createTestDb();
  const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
  await repo.upsert({
    id: 'a',
    title: 'AI story',
    url: null,
    region: 'World',
    topic: 'AI',
    significance: 9,
    whyItMatters: 'Because.',
    memberRefs: [{ source: 'hackernews', externalId: '1' }],
  });
  await repo.upsert({
    id: 'b',
    title: 'Israeli politics',
    url: null,
    region: 'Israel',
    topic: 'Politics',
    significance: 4,
    whyItMatters: null,
    memberRefs: [{ source: 'gdelt', externalId: '2' }],
  });
  return createApp(repo);
}

describe('HTTP API', () => {
  it('GET /api/stories returns stories ordered by significance', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/stories');
    expect(res.status).toBe(200);
    const body = await res.json() as { stories: { id: string }[] };
    expect(body.stories.map((s: { id: string }) => s.id)).toEqual(['a', 'b']);
  });

  it('GET /api/stories filters by region query param', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/stories?region=Israel');
    const body = await res.json() as { stories: { id: string }[] };
    expect(body.stories.map((s: { id: string }) => s.id)).toEqual(['b']);
  });

  it('GET /health returns ok', async () => {
    const app = await appWithStories();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
