import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { DrizzleTickReportRepo } from '../../src/db/tick-report-repo.js';
import { DrizzleChatPreferencesRepo } from '../../src/db/chat-preferences-repo.js';
import { DrizzleWebAuthRepo } from '../../src/db/web-auth-repo.js';
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

/** Build an app with the Log in with Telegram flow wired (ADR-0040). */
async function appWithAuth() {
  const db = await createTestDb();
  const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
  const prefs = new DrizzleChatPreferencesRepo(db);
  const webAuth = new DrizzleWebAuthRepo(db);
  const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
  const app = createApp(
    repo,
    queryEngine,
    { minutes: 10 },
    { maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: false },
    undefined,
    { webAuth, prefs, botUsername: 'HorizonBot', now: () => 1000 },
  );
  return { app, webAuth, prefs };
}

/** The `name=value` half of the Set-Cookie header, for replaying as a Cookie. */
function cookieOf(res: Response): string {
  const sc = res.headers.get('set-cookie');
  return sc ? (sc.split(';')[0] ?? '') : '';
}

describe('Log in with Telegram + shared preferences (ADR-0040)', () => {
  it('pairs the web to a chat, then shares preferences both ways', async () => {
    const { app, webAuth, prefs } = await appWithAuth();

    const start = await app.request('/api/auth/start', { method: 'POST' });
    expect(start.status).toBe(200);
    const { code, deepLink } = (await start.json()) as { code: string; deepLink: string };
    expect(deepLink).toBe('https://t.me/HorizonBot?start=link_' + code);
    const cookie = cookieOf(start);
    expect(cookie).toMatch(/^horizon_session=/);

    // Before the bot claims the code, the session is still pending.
    const before = await app.request('/api/auth/status', { headers: { cookie } });
    expect(await before.json()).toEqual({ authenticated: false });

    // The Telegram bot claims the code for chat 77 (as HorizonBot.handleLink does).
    expect(await webAuth.claim(code, 77, 'Omer', 1000)).toBe('linked');

    const after = await app.request('/api/auth/status', { headers: { cookie } });
    expect(await after.json()).toEqual({ authenticated: true, name: 'Omer' });

    // Saving prefs on the web writes the SAME chat_preferences row the bot reads.
    const put = await app.request('/api/preferences', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ topics: ['AI', 'Israel'], minutes: 7 }),
    });
    expect(put.status).toBe(200);

    const got = await app.request('/api/preferences', { headers: { cookie } });
    expect(await got.json()).toMatchObject({ topics: ['AI', 'Israel'], minutes: 7 });

    // The bot side (chat 77) sees exactly the same preferences.
    const shared = await prefs.get(77);
    expect(shared?.topics).toEqual(['AI', 'Israel']);
    expect(shared?.defaultMinutes).toBe(7);
  });

  it('rejects preference reads/writes without a linked session (401)', async () => {
    const { app } = await appWithAuth();
    expect((await app.request('/api/preferences')).status).toBe(401);
    const put = await app.request('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minutes: 5 }),
    });
    expect(put.status).toBe(401);
  });

  it('invalid topics are dropped and out-of-range minutes are clamped', async () => {
    const { app, webAuth } = await appWithAuth();
    const start = await app.request('/api/auth/start', { method: 'POST' });
    const { code } = (await start.json()) as { code: string };
    const cookie = cookieOf(start);
    await webAuth.claim(code, 5, null, 1000);

    const put = await app.request('/api/preferences', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ topics: ['AI', 'Nonsense'], minutes: 99999 }),
    });
    const body = (await put.json()) as { topics: string[]; minutes: number };
    expect(body.topics).toEqual(['AI']); // "Nonsense" filtered out
    expect(body.minutes).toBe(60); // clamped to maxMinutes
  });

  it('logout ends the session', async () => {
    const { app, webAuth } = await appWithAuth();
    const start = await app.request('/api/auth/start', { method: 'POST' });
    const { code } = (await start.json()) as { code: string };
    const cookie = cookieOf(start);
    await webAuth.claim(code, 9, null, 1000);
    expect((await (await app.request('/api/auth/status', { headers: { cookie } })).json())).toMatchObject({ authenticated: true });

    await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(await (await app.request('/api/auth/status', { headers: { cookie } })).json()).toEqual({ authenticated: false });
  });

  it('the viewer shows "Connect Telegram" when auth is wired', async () => {
    const { app } = await appWithAuth();
    const html = await (await app.request('/')).text();
    expect(html).toContain('Connect Telegram');
    expect(html).not.toContain('Sign in'); // the old fake localStorage login is gone
  });

  it('auth endpoints 404 when auth is not wired (guest-only viewer)', async () => {
    const app = await appWithStories(); // no auth option
    expect((await app.request('/api/auth/start', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/preferences')).status).toBe(404);
  });
});
