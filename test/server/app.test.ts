import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { HorizonQuery, type QueryParams } from '../../src/presentation/horizon-query.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLLM } from '../helpers/fake-llm.js';

const PARAMS: QueryParams = {
  textWordsPerMinute: 20,
  audioWordsPerMinute: 10,
  wordCost: { headline: 10, brief: 20, full: 40 },
  candidatePool: 100,
};

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
  const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
  return createApp(repo, queryEngine, { minutes: 10 });
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

  it('GET /api/brief returns a budgeted text brief', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/brief?minutes=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { brief: string };
    expect(body.brief).toContain('AI story');
  });

  it('GET /api/brief filters by topic query param', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/brief?minutes=10&topic=Politics');
    const body = (await res.json()) as { brief: string };
    expect(body.brief).toContain('Israeli politics');
    expect(body.brief).not.toContain('AI story');
  });

  it('GET /api/outline returns a topic-grouped outline', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/outline?topic=AI&minutes=10');
    const body = (await res.json()) as { outline: string };
    expect(body.outline).toContain('AI outline');
    expect(body.outline).toContain('AI story');
  });

  it('GET /api/outline without a topic is a 400', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/outline');
    expect(res.status).toBe(400);
  });

  it('GET /api/podcast returns a narrated script', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/podcast?minutes=10');
    const body = (await res.json()) as { script: string };
    expect(body.script).toContain('Narrated'); // FakeLLM.narrate default
  });

  it('GET / seeds the viewer time slider from the configured default', async () => {
    const app = await appWithStories();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('value="10"'); // defaults.minutes
  });
});
