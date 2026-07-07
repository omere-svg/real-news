import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { TOPICS } from '../../src/domain/types.js';
import { renderDashboard } from '../../src/server/ui.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { DrizzleSignalObservationRepo } from '../../src/db/signal-observation-repo.js';
import { DrizzleTickReportRepo, type TickRecord } from '../../src/db/tick-report-repo.js';
import { DrizzleChatPreferencesRepo } from '../../src/db/chat-preferences-repo.js';
import { DrizzleWebAuthRepo } from '../../src/db/web-auth-repo.js';
import { DrizzleUsageRepo, utcDay } from '../../src/db/usage-repo.js';
import { DrizzleChatTraceRepo } from '../../src/db/chat-trace-repo.js';
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

  it('GET /api/podcast returns a narrated script', async () => {
    const app = await appWithStories();
    const res = await app.request('/api/podcast?minutes=10');
    const body = (await res.json()) as { script: string; audio: string | null };
    expect(body.script).toContain('Narrated'); // FakeLLM.narrate default
    expect(body.audio).toBeNull(); // no synthesizer wired ⇒ script-only
  });

  it('GET /api/podcast narrates to base64 audio when a synthesizer is wired (ADR-0020)', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    await repo.upsert({
      id: 'a', title: 'AI story', url: null, topic: 'AI', significance: 9,
      whyItMatters: 'Because.', memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(repo, queryEngine, { minutes: 10 }, {
      maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: true,
      synthesizer: { synthesize: async () => Buffer.from('fake-mp3-bytes') },
    });
    const res = await app.request('/api/podcast?minutes=10');
    const body = (await res.json()) as { script: string; audio: string | null };
    expect(body.script).toContain('Narrated');
    expect(body.audio).toBe(Buffer.from('fake-mp3-bytes').toString('base64'));
  });

  it('GET /api/podcast degrades to script-only when TTS returns null', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    await repo.upsert({
      id: 'a', title: 'AI story', url: null, topic: 'AI', significance: 9,
      whyItMatters: 'Because.', memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(repo, queryEngine, { minutes: 10 }, {
      maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: true,
      synthesizer: { synthesize: async () => null },
    });
    const body = (await (await app.request('/api/podcast?minutes=10')).json()) as {
      script: string; audio: string | null;
    };
    expect(body.script).toContain('Narrated');
    expect(body.audio).toBeNull();
  });

  it('GET /api/podcast is 404 when web podcast is disabled (default)', async () => {
    const app = await appWith({ maxMinutes: 60, podcastEnabled: false });
    const res = await app.request('/api/podcast?minutes=5');
    expect(res.status).toBe(404);
  });

  it('GET /api/podcast enforces the shared global daily cap (ADR-0052)', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    await repo.upsert({
      id: 'a', title: 'AI story', url: null, topic: 'AI', significance: 9,
      whyItMatters: 'Because.', memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const usage = new DrizzleUsageRepo(db);
    const app = createApp(repo, queryEngine, { minutes: 10 }, {
      maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: true,
      usage, globalPodcastPerDay: 1,
    });
    expect((await app.request('/api/podcast?minutes=5')).status).toBe(200); // 1st allowed
    expect((await app.request('/api/podcast?minutes=5')).status).toBe(429); // 2nd over the cap
  });

  it('podcast refusals do not consume the global budget', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    await repo.upsert({
      id: 'a', title: 'AI story', url: null, topic: 'AI', significance: 9,
      whyItMatters: 'Because.', memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const usage = new DrizzleUsageRepo(db);
    const app = createApp(repo, queryEngine, { minutes: 10 }, {
      maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: true,
      usage, globalPodcastPerDay: 1,
      // A generous per-IP allowance so this test exercises the global-budget path,
      // not the per-IP limiter — each call uses a distinct IP for the same reason.
      podcastIpLimit: 100,
    });
    const day = utcDay(Date.now());

    const first = await app.request('/api/podcast?minutes=5', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    expect(first.status).toBe(200); // charges the budget to 1 on success
    expect(await usage.peek('global:podcast', day)).toBe(1);

    // Every subsequent refusal (already at cap) must leave the counter untouched.
    const refused1 = await app.request('/api/podcast?minutes=5', { headers: { 'x-forwarded-for': '1.1.1.2' } });
    expect(refused1.status).toBe(429);
    expect(await usage.peek('global:podcast', day)).toBe(1);

    const refused2 = await app.request('/api/podcast?minutes=5', { headers: { 'x-forwarded-for': '1.1.1.3' } });
    expect(refused2.status).toBe(429);
    expect(await usage.peek('global:podcast', day)).toBe(1);
  });

  it('per-IP limit returns 429', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    await repo.upsert({
      id: 'a', title: 'AI story', url: null, topic: 'AI', significance: 9,
      whyItMatters: 'Because.', memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(repo, queryEngine, { minutes: 10 }, {
      maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: true,
      podcastIpLimit: 2, podcastIpWindowMs: 60_000,
    });
    const headers = { 'x-forwarded-for': '203.0.113.50' };

    expect((await app.request('/api/podcast?minutes=5', { headers })).status).toBe(200);
    expect((await app.request('/api/podcast?minutes=5', { headers })).status).toBe(200);
    const limited = await app.request('/api/podcast?minutes=5', { headers });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'too many requests; try again later' });

    // A different IP is unaffected by the first IP's budget.
    const other = await app.request('/api/podcast?minutes=5', {
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });
    expect(other.status).toBe(200);
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

  it('the viewer ships the card + podcast renderers (ADR-0050/0060)', async () => {
    const app = await appWithStories();
    const html = await (await app.request('/')).text();
    // Brief renders as cards, podcast as an audio player — not a <pre> blob.
    expect(html).toContain('function renderDoc');
    expect(html).toContain('function renderPodcast');
    // Only Brief + Podcast formats remain (Stories + Topic outline removed, ADR-0060).
    expect(html).toContain('data-fmt="brief"');
    expect(html).not.toContain('data-fmt="stories"');
    expect(html).not.toContain('data-fmt="outline"');
    // Backend is made legible (sources / zero-scraping / live freshness).
    expect(html).toContain('zero scraping');
    expect(html).toContain('loadFreshness');
  });

  it('the viewer routes story links through a scheme-checked safeUrl, never a raw href (ADR-0049)', async () => {
    const app = await appWithStories();
    const html = await (await app.request('/')).text();
    // The XSS fix: a feed-controlled url must be escaped + scheme-checked, not
    // interpolated raw into the href attribute.
    expect(html).toContain('function safeUrl');
    expect(html).toContain("'<a href=\"'+esc(su)+'\"");
    expect(html).not.toContain("'<a href=\"'+s.url+'\"");
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

  it('GET /api/stats reports the accumulation counters (stories, sources, signals, ticks)', async () => {
    const db = await createTestDb();
    const clock = new FakeClock(1000);
    const repo = new DrizzleStoryRepo(db, clock);

    // One corroborated story (2 refs) and one single-source story.
    await repo.upsert({
      id: 'multi', title: 'Corroborated quake', url: null, topic: 'Climate',
      significance: 9, whyItMatters: null,
      memberRefs: [{ source: 'usgs-quakes', externalId: '1' }, { source: 'gdelt', externalId: '2' }],
    });
    await repo.upsert({
      id: 'single', title: 'AI story', url: null, topic: 'AI',
      significance: 5, whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: '3' }],
    });
    // A later tick re-touches "multi" — updated across ticks (> ~25min after first seen).
    clock.advance(30 * 60_000);
    await repo.upsert({
      id: 'multi', title: 'Corroborated quake', url: null, topic: 'Climate',
      significance: 9.5, whyItMatters: null,
      memberRefs: [{ source: 'usgs-quakes', externalId: '1' }, { source: 'gdelt', externalId: '2' }],
    });

    const signals = new DrizzleSignalObservationRepo(db);
    await signals.record([
      { source: 'coingecko', key: 'a', topic: 'Business', value: 1, observedAt: 500 },
      { source: 'coingecko', key: 'b', topic: 'Business', value: 2, observedAt: 2000 },
    ]);

    const ticks = new DrizzleTickReportRepo(db);
    await ticks.record({
      ranAt: 100, durationMs: 100, ok: true, error: null, extracted: 5,
      storiesUpserted: 2, signalsObserved: 2,
      skipped: [], failed: [], signalsSkipped: [], signalsFailed: [],
    });

    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(
      repo, queryEngine, { minutes: 10 },
      { maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: false },
      ticks, undefined, undefined, signals,
    );

    const res = await app.request('/api/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body).toMatchObject({
      stories: 2,
      multiSourceStories: 1,
      storiesUpdatedAcrossTicks: 1,
      signalObservations: 2,
      oldestSignalAt: 500,
      ticksRecorded: 1,
    });
    expect(body.generatedAt).toBeGreaterThan(0);
  });

  it('GET /api/stats degrades to zeros when no signal/tick repos are wired', async () => {
    const app = await appWithStories();
    const body = (await (await app.request('/api/stats')).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      stories: 2, signalObservations: 0, oldestSignalAt: null, ticksRecorded: 0,
      tokens: { cheap: 0, deep: 0, embed: 0, tts: 0, total: 0, ttsCharacters: 0 }, // no usage store wired
      subscribers: 0, questionsAnswered: 0, // no prefs/chatTraces repo wired
    });
  });

  it('stats expose subscribers and answered-questions counts', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const prefs = new DrizzleChatPreferencesRepo(db);
    const webAuth = new DrizzleWebAuthRepo(db);
    const chatTraces = new DrizzleChatTraceRepo(db);

    // Two chats with an active daily-brief subscription (briefAt set), one without.
    await prefs.set(1, { briefAt: '08:00' });
    await prefs.set(2, { briefAt: '09:30' });
    await prefs.set(3, { topics: ['AI'] }); // no briefAt ⇒ not subscribed

    await chatTraces.record({
      createdAt: 1000, question: 'q1', steps: [], answeredFromNews: true, plan: '', path: 'agent',
    });
    await chatTraces.record({
      createdAt: 2000, question: 'q2', steps: [], answeredFromNews: false, plan: '', path: 'fallback',
    });

    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(
      repo, queryEngine, { minutes: 10 },
      { maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: false },
      undefined, { webAuth, prefs, now: () => 1000 }, undefined, undefined, chatTraces,
    );

    const body = (await (await app.request('/api/stats')).json()) as Record<string, number>;
    expect(body.subscribers).toBe(2);
    expect(body.questionsAnswered).toBe(2);
  });

  it('public chat-traces endpoint never returns the full question text', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const chatTraces = new DrizzleChatTraceRepo(db);
    const fullQuestion = 'q'.repeat(300);
    await chatTraces.record({
      createdAt: 1000, question: fullQuestion, steps: [], answeredFromNews: false,
      plan: 'search then answer', path: 'agent',
    });
    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(
      repo, queryEngine, { minutes: 10 },
      { maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: false },
      undefined, undefined, undefined, undefined, chatTraces,
    );

    const res = await app.request('/api/chat-traces');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { traces: { question: string; plan: string; path: string }[] };
    expect(body.traces).toHaveLength(1);
    expect(body.traces[0]?.question).not.toBe(fullQuestion);
    expect(body.traces[0]?.question.length).toBeLessThanOrEqual(80);
    // The rubric plan→act→observe evidence is exposed alongside the trajectory.
    expect(body.traces[0]?.plan).toBe('search then answer');
    expect(body.traces[0]?.path).toBe('agent');
  });

  it("GET /api/stats surfaces today's durable LLM token counters", async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const usage = new DrizzleUsageRepo(db);
    const today = new Date().toISOString().slice(0, 10);
    await usage.add('global:tokens:cheap', today, 1500);
    await usage.add('global:tokens:deep', today, 400);
    await usage.add('global:tokens:cheap', '2020-01-01', 999); // stale day — excluded

    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(repo, queryEngine, { minutes: 10 }, {
      maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: false, usage,
    });

    const body = (await (await app.request('/api/stats')).json()) as {
      tokens: {
        day: string;
        cheap: number;
        deep: number;
        embed: number;
        tts: number;
        total: number;
        ttsCharacters: number;
      };
    };
    // total is token-denominated tiers only (cheap + deep + embed); tts
    // bills in characters, not tokens, so it does not feed total.
    expect(body.tokens).toEqual({
      day: today, cheap: 1500, deep: 400, embed: 0, tts: 0, total: 1900, ttsCharacters: 0,
    });
  });

  it("GET /api/stats surfaces today's embed and tts token counters, and keeps tts out of total", async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    const usage = new DrizzleUsageRepo(db);
    const today = new Date().toISOString().slice(0, 10);
    await usage.add('global:tokens:embed', today, 300);
    await usage.add('global:tokens:tts', today, 900);

    const queryEngine = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });
    const app = createApp(repo, queryEngine, { minutes: 10 }, {
      maxMinutes: 60, maxPodcastMinutes: 20, podcastEnabled: false, usage,
    });

    const body = (await (await app.request('/api/stats')).json()) as {
      tokens: { embed: number; tts: number; total: number; ttsCharacters: number };
    };
    expect(body.tokens.embed).toBe(300);
    expect(body.tokens.tts).toBe(900);
    expect(body.tokens.total).toBe(300); // embed only — tts is reported separately
    expect(body.tokens.ttsCharacters).toBe(900);
  });

  it('a first-time visitor (no saved prefs) defaults to ALL topics, so the global lead is visible', async () => {
    const app = await appWithStories();
    const html = await (await app.request('/')).text();
    // Saved prefs restore as before; with none saved the client clears the
    // server-seeded preferred-topics default back to "All" (no filter).
    expect(html).toContain('if (Array.isArray(cached.topics)) setTopics(cached.topics);');
    expect(html).toContain('else setTopics([]);');
  });

  it('the podcast hint tells the reader to press Generate to produce the audio episode', async () => {
    const app = await appWithStories();
    const html = await (await app.request('/')).text();
    expect(html).toContain('A short narrated audio episode of your top stories');
    expect(html).toContain('✨ Generate');
    // The web podcast is now real audio, not a script preview (ADR-0020).
    expect(html).toContain('function renderPodcast');
  });
});

describe('dashboard rehab (health triage, humanized durations, accumulation strip)', () => {
  const rec = (over: Partial<TickRecord> = {}): TickRecord => ({
    ranAt: 0, durationMs: 248_061, ok: true, error: null, extracted: 5,
    storiesUpserted: 2, signalsObserved: 1,
    skipped: [], failed: [], signalsSkipped: [], signalsFailed: [],
    ...over,
  });

  it('humanizes durations ("4m 08s", not "248061ms")', () => {
    const html = renderDashboard([rec({ ranAt: 1000 })], [], 61_000);
    expect(html).toContain('4m 08s');
    expect(html).not.toContain('248061ms');
  });

  it('a successful tick with failed sources is amber "OK — N sources degraded", not red', () => {
    const html = renderDashboard(
      [rec({ failed: [{ source: 'gdelt', error: 'boom' }] })], [], 60_000,
    );
    expect(html).toContain('banner warn');
    expect(html).toContain('OK — 1 source degraded');
    expect(html).not.toContain('banner bad');
    expect(html).not.toContain('Degraded ·');
  });

  it('a clean recent tick is green Healthy', () => {
    const html = renderDashboard([rec()], [], 60_000);
    expect(html).toContain('banner ok');
    expect(html).toContain('Healthy');
  });

  it('an overdue last tick (~2× the cadence) is red even if it succeeded', () => {
    const html = renderDashboard([rec({ ranAt: 0 })], [], 2 * 3600_000); // 2h later
    expect(html).toContain('banner bad');
    expect(html).toContain('OVERDUE');
  });

  it('a failed last tick is red', () => {
    const html = renderDashboard([rec({ ok: false, error: 'exploded' })], [], 60_000);
    expect(html).toContain('banner bad');
    expect(html).toContain('Last tick FAILED');
  });

  it('ships the accumulation stats strip fed by /api/stats', () => {
    const html = renderDashboard([rec()], [], 60_000);
    expect(html).toContain('stories accumulated');
    expect(html).toContain('days of signal history');
    expect(html).toContain("fetch('/api/stats')");
    expect(html).toContain('Accumulated since');
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

  it('preferences dedupes topics and rejects oversized arrays', async () => {
    const { app, webAuth } = await appWithAuth();
    const start = await app.request('/api/auth/start', { method: 'POST' });
    const { code } = (await start.json()) as { code: string };
    const cookie = cookieOf(start);
    await webAuth.claim(code, 11, null, 1000);

    // Duplicate entries collapse to a single occurrence.
    const dup = await app.request('/api/preferences', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ topics: ['AI', 'AI', 'Israel', 'Israel'] }),
    });
    expect(dup.status).toBe(200);
    const dupBody = (await dup.json()) as { topics: string[] };
    expect(dupBody.topics).toEqual(['AI', 'Israel']);

    // An array larger than the Topic vocabulary is rejected outright.
    const oversized = Array.from({ length: TOPICS.length + 1 }, () => 'AI');
    const big = await app.request('/api/preferences', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ topics: oversized }),
    });
    expect(big.status).toBe(400);
    const bigBody = (await big.json()) as { error: string };
    expect(bigBody.error).toMatch(/topic/i);
  });

  it('rate-limits /api/auth/start per IP: 429 after N requests in the window', async () => {
    const { app } = await appWithAuth();
    const headers = { 'x-forwarded-for': '203.0.113.9' };

    // Default budget is 5/window; the fixed clock (now: () => 1000) keeps every
    // call in the same window, so the 6th must be rejected.
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/auth/start', { method: 'POST', headers });
      expect(res.status).toBe(200);
    }
    const limited = await app.request('/api/auth/start', { method: 'POST', headers });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'too many requests; try again later' });

    // A different IP is unaffected by the first IP's budget.
    const other = await app.request('/api/auth/start', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.4' },
    });
    expect(other.status).toBe(200);
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

  it('the viewer shows a "Chat with Horizon on Telegram" CTA when a bot username is configured', async () => {
    const { app } = await appWithAuth();
    const html = await (await app.request('/')).text();
    // A direct t.me link — separate from (and in addition to) the login flow.
    expect(html).toContain('href="https://t.me/HorizonBot"');
    expect(html).toContain('Chat with Horizon on Telegram');
  });

  it('the bot CTA is absent when no bot username is configured', async () => {
    const app = await appWithStories(); // no auth ⇒ no botUsername
    const html = await (await app.request('/')).text();
    expect(html).not.toContain('t.me/');
  });

  it('auth endpoints 404 when auth is not wired (guest-only viewer)', async () => {
    const app = await appWithStories(); // no auth option
    expect((await app.request('/api/auth/start', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/preferences')).status).toBe(404);
  });
});
