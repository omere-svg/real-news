import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { DrizzleTickReportRepo } from '../../src/db/tick-report-repo.js';
import { HorizonQuery, type QueryParams } from '../../src/presentation/horizon-query.js';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLLM } from '../helpers/fake-llm.js';

const PARAMS: QueryParams = {
  textWordsPerMinute: 20,
  audioWordsPerMinute: 10,
  wordCost: { headline: 10, brief: 20, full: 40 },
  candidatePool: 100,
  minDepth: 'headline',
  minStories: 0,
  maxStories: 100,
};

async function appWithStories() {
  const db = await createTestDb();
  const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
  await repo.upsert({
    id: 'a',
    title: 'AI story',
    url: null,
    topic: 'AI',
    significance: 9,
    whyItMatters: 'Because.',
    memberRefs: [{ source: 'hackernews', externalId: '1' }],
  });
  await repo.upsert({
    id: 'b',
    title: 'Israeli politics',
    url: null,
    topic: 'Israel',
    significance: 4,
    whyItMatters: null,
    memberRefs: [{ source: 'gdelt', externalId: '2' }],
  });
  const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
  return createApp(repo, queryEngine, { minutes: 10 }, { maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: true });
}

async function appWith(web: { maxMinutes: number; maxPodcastMinutes?: number; podcastEnabled: boolean }) {
  const db = await createTestDb();
  const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
  await repo.upsert({
    id: 'a', title: 'AI story', url: null, topic: 'AI',
    significance: 9, whyItMatters: 'Because.',
    memberRefs: [{ source: 'hackernews', externalId: '1' }],
  });
  const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
  return createApp(repo, queryEngine, { minutes: 10 }, { maxPodcastMinutes: web.maxMinutes, ...web });
}

describe('HTTP API', () => {
  it('GET /api/stories returns stories ordered by significance', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/stories');
    expect(res.status).toBe(200);
    const body = await res.json() as { stories: { id: string }[] };
    expect(body.stories.map((s: { id: string }) => s.id)).toEqual(['a', 'b']);
  });

  it('GET /api/stories filters by topic query param', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/stories?topic=Israel');
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
    const res = await app.request('/api/brief?minutes=10&topic=Israel');
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

  it('GET /api/podcast is 404 when web podcast is disabled (default)', async () => {
    const app = await appWith({ maxMinutes: 60, podcastEnabled: false });
    const res = await app.request('/api/podcast?minutes=5');
    expect(res.status).toBe(404);
  });

  it('clamps an oversized minutes query param', async () => {
    // maxMinutes 1 → even a huge request yields a tiny brief (1 story, headline only).
    const app = await appWith({ maxMinutes: 1, podcastEnabled: false });
    const res = await app.request('/api/brief?minutes=999999');
    const body = (await res.json()) as { brief: string };
    // 1 min * 20 wpm = 20 words → at most ~2 headlines; never the whole pool.
    expect(body.brief.split('\n').filter((l) => l.startsWith('•')).length).toBeLessThanOrEqual(2);
  });

  it('GET / seeds the viewer time slider from the configured default', async () => {
    const app = await appWithStories();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('value="10"'); // defaults.minutes
  });

  it('GET /api/ticks returns recent tick records, newest first (ADR-0033)', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const ticks = new DrizzleTickReportRepo(db);
    const rec = (ranAt: number, extracted: number) => ({
      ranAt, durationMs: 100, ok: true, error: null, extracted,
      storiesUpserted: 1, signalsObserved: 0,
      skipped: [], failed: [], signalsSkipped: [], signalsFailed: [],
    });
    await ticks.record(rec(100, 5));
    await ticks.record(rec(200, 9));
    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(repo, queryEngine, { minutes: 10 }, { maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: false }, ticks);

    const res = await app.request('/api/ticks');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticks: { ranAt: number }[] };
    expect(body.ticks.map((t) => t.ranAt)).toEqual([200, 100]);
  });

  it('GET /dashboard renders an HTML health page (ADR-0033)', async () => {
    const app = await appWithStories(); // no tick repo wired → empty dashboard
    const res = await app.request('/dashboard');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Horizon — Operations');
    expect(html).toContain('No ticks recorded yet');
  });

  it('GET /api/ticks is empty when no tick repo is wired', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/ticks');
    const body = (await res.json()) as { ticks: unknown[] };
    expect(body.ticks).toEqual([]);
  });
});
