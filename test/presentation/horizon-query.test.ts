import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import type { StoryUpsert } from '../../src/db/story-repo.js';
import {
  HorizonQuery,
  type QueryParams,
} from '../../src/presentation/horizon-query.js';

const PARAMS: QueryParams = {
  textWordsPerMinute: 20,
  audioWordsPerMinute: 10,
  wordCost: { headline: 10, brief: 20, full: 40 },
  candidatePool: 100,
  minDepth: 'headline', // these tests exercise the general engine; floor tested separately
  minStories: 0,
  maxStories: 100,
};

function upsert(over: Partial<StoryUpsert> = {}): StoryUpsert {
  return {
    id: 's',
    title: 'A story',
    url: null,
    topic: 'AI',
    significance: 5,
    whyItMatters: null,
    memberRefs: [],
    ...over,
  };
}

async function seed(...stories: StoryUpsert[]) {
  const db = await createTestDb();
  const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
  for (const s of stories) await repo.upsert(s);
  return repo;
}

describe('HorizonQuery', () => {
  it('textBrief renders selected stories ordered by significance, deepest first', async () => {
    const repo = await seed(
      upsert({ id: 'a', title: 'Alpha', significance: 9, whyItMatters: 'Alpha matters. Detail.' }),
      upsert({ id: 'b', title: 'Bravo', significance: 4, whyItMatters: 'Bravo matters.' }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 3 }); // 60-word budget

    expect(brief).toContain('2 stories');
    expect(brief.indexOf('Alpha')).toBeLessThan(brief.indexOf('Bravo'));
    expect(brief).toContain('9.0');
    expect(brief).toContain('Alpha matters. Detail.'); // top story rendered in full
  });

  it('textBrief appends each story\'s source link for provenance (ADR-0027)', async () => {
    const repo = await seed(
      upsert({ id: 'a', title: 'Alpha', significance: 9, url: 'https://example.com/alpha' }),
      upsert({ id: 'b', title: 'Bravo', significance: 4, url: null }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 3 });

    expect(brief).toContain('🔗 https://example.com/alpha'); // linked
    expect(brief.match(/🔗/g)?.length).toBe(1); // the url-less story has no link line
  });

  it('textBrief appends a compact score rationale from the breakdown (ADR-0034)', async () => {
    const repo = await seed(
      upsert({
        id: 'a',
        title: 'Alpha',
        significance: 9,
        scoreBreakdown: {
          base: 9,
          recencyFactor: 1, // fresh
          impact: 0.9, // major real-world impact
          components: [
            { key: 'impact', value: 0.9 },
            { key: 'corroboration', value: 0.7 },
            { key: 'authority', value: 0.7 }, // official source
            { key: 'attention', value: 0.2 },
          ],
          signalNudge: 0,
          signals: {
            points: 0,
            mentions: 0,
            tone: 0,
            sourceWeight: 0.7,
            ageHours: 0,
            corroboration: 4, // 4 sources
          },
        },
      }),
      upsert({ id: 'b', title: 'Bravo', significance: 4 }), // no breakdown → no tail
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 3 });

    expect(brief).toContain('major real-world impact');
    expect(brief).toContain('4 sources');
    expect(brief).toContain('official source');
    expect(brief).toContain('fresh');
    // Bravo has no breakdown, so its descriptor carries no rationale tail.
    expect(brief).toContain('significance 4.0');
    expect(brief).not.toMatch(/significance 4\.0 ·/);
  });

  it('renders each story as a structured block: headline, summary, why-it-matters, descriptor, link', async () => {
    const repo = await seed(
      upsert({
        id: 'a',
        title: 'Alpha',
        topic: 'AI',
        significance: 9,
        summary: 'First thing happened. Second thing too.',
        whyItMatters: 'It changes the landscape.',
        url: 'https://example.com/a',
      }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 5 }); // enough budget for full depth
    const block = brief.split('\n\n').at(-1)!.split('\n');

    expect(block[0]).toBe('📰 Alpha'); // headline first
    expect(block[1]).toBe('First thing happened. Second thing too.'); // what happened
    expect(block).toContain('💡 It changes the landscape.'); // why it matters
    expect(block).toContain('🏷 AI · significance 9.0'); // short descriptor
    expect(block.at(-1)).toBe('🔗 https://example.com/a'); // link last
  });

  it('brief depth trims the what-happened summary to two sentences', async () => {
    const repo = await seed(
      upsert({ id: 'a', title: 'Alpha', significance: 9, summary: 'One. Two. Three.' }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 1 }); // 20-word budget ⇒ brief depth
    expect(brief).toContain('One. Two.');
    expect(brief).not.toContain('Three.');
  });

  it('suppresses same-event near-duplicates in one brief via stored vectors (ADR-0053)', async () => {
    const repo = await seed(
      upsert({ id: 'a', title: 'China tests long-range missile', significance: 9 }),
      upsert({ id: 'b', title: 'Australian PM reacts to China missile test', significance: 8 }),
      upsert({ id: 'c', title: 'Heatwave hits Europe', significance: 7 }),
    );
    // a and b are the same event (high cosine); c is unrelated.
    await repo.putVector('a', [1, 0, 0]);
    await repo.putVector('b', [0.95, 0.3, 0]);
    await repo.putVector('c', [0, 1, 0]);
    const q = new HorizonQuery({
      storyRepo: repo,
      llm: new FakeLLM(),
      params: { ...PARAMS, dedupSimilarity: 0.8 },
    });

    const brief = await q.textBrief({ minutes: 5 });

    expect(brief).toContain('China tests long-range missile');
    expect(brief).not.toContain('Australian PM'); // duplicate suppressed
    expect(brief).toContain('Heatwave hits Europe'); // distinct story keeps its slot
  });

  it('a story with no stored vector is never suppressed', async () => {
    const repo = await seed(
      upsert({ id: 'a', title: 'Alpha', significance: 9 }),
      upsert({ id: 'b', title: 'Bravo', significance: 8 }),
    );
    await repo.putVector('a', [1, 0]);
    const q = new HorizonQuery({
      storyRepo: repo,
      llm: new FakeLLM(),
      params: { ...PARAMS, dedupSimilarity: 0.8 },
    });
    const brief = await q.textBrief({ minutes: 5 });
    expect(brief).toContain('Alpha');
    expect(brief).toContain('Bravo');
  });

  it('textBrief filters by the requested topics', async () => {
    const repo = await seed(
      upsert({ id: 'ai', title: 'AI thing', topic: 'AI', significance: 8 }),
      upsert({ id: 'pol', title: 'Politics thing', topic: 'Politics', significance: 9 }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 5, topics: ['AI'] });

    expect(brief).toContain('AI thing');
    expect(brief).not.toContain('Politics thing');
  });

  it('textBrief re-ranks by soft preference weights, lifting a favored lower-significance topic (ADR-0026)', async () => {
    const repo = await seed(
      upsert({ id: 'pol', title: 'Politics thing', topic: 'Politics', significance: 9 }),
      upsert({ id: 'ai', title: 'AI thing', topic: 'AI', significance: 6 }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    // By raw significance Politics (9) outranks AI (6); a 2× AI weight flips the order.
    const brief = await q.textBrief({ minutes: 5, topicWeights: { AI: 2 } });

    expect(brief.indexOf('AI thing')).toBeLessThan(brief.indexOf('Politics thing'));
  });

  it('textBrief excludes a muted topic (weight 0) (ADR-0026)', async () => {
    const repo = await seed(
      upsert({ id: 'ai', title: 'AI thing', topic: 'AI', significance: 8 }),
      upsert({ id: 'sport', title: 'Sports thing', topic: 'Sports', significance: 9 }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 5, topicWeights: { Sports: 0 } });

    expect(brief).toContain('AI thing');
    expect(brief).not.toContain('Sports thing');
  });

  it('textBrief honours the time budget: a tiny budget yields one headline, no analysis', async () => {
    const repo = await seed(
      upsert({ id: 'a', title: 'Alpha', significance: 9, whyItMatters: 'Should not appear.' }),
      upsert({ id: 'b', title: 'Bravo', significance: 4, whyItMatters: 'Nor this.' }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 0.5 }); // 10 words = 1 headline

    expect(brief).toContain('Alpha');
    expect(brief).not.toContain('Bravo');
    expect(brief).not.toContain('Should not appear.');
  });

  it('textBrief reports when nothing fits the budget', async () => {
    const repo = await seed(upsert({ id: 'a', title: 'Alpha', significance: 9 }));
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    expect(await q.textBrief({ minutes: 0 })).toContain('No stories');
  });

  it('textBrief with an explicit topic filter excludes other topics, ordered by significance', async () => {
    const repo = await seed(
      upsert({ id: 'a1', title: 'AI one', topic: 'AI', significance: 8 }),
      upsert({ id: 'a2', title: 'AI two', topic: 'AI', significance: 7 }),
      upsert({ id: 'p', title: 'A politics piece', topic: 'Politics', significance: 9 }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const brief = await q.textBrief({ minutes: 10, topics: ['AI'] });

    expect(brief).toContain('AI one');
    expect(brief).toContain('AI two');
    expect(brief.indexOf('AI one')).toBeLessThan(brief.indexOf('AI two')); // by significance
    expect(brief).not.toContain('A politics piece');
  });

  it('podcastScript narrates the budgeted brief via the deep tier', async () => {
    const repo = await seed(upsert({ id: 'a', title: 'Alpha', significance: 9 }));
    let seen: { brief: string; targetWords?: number } = { brief: '' };
    const llm = new FakeLLM({
      narrate: (input) => {
        seen = input;
        return 'SPOKEN SCRIPT';
      },
    });
    const q = new HorizonQuery({ storyRepo: repo, llm, params: PARAMS });

    const script = await q.podcastScript({ minutes: 5 });

    expect(script).toBe('SPOKEN SCRIPT');
    expect(llm.narrateCalls).toBe(1);
    expect(seen.brief).toContain('Alpha'); // narration is built from the brief
    // The narration is aimed at minutes × speaking rate so the audio fills the budget (ADR-0032).
    expect(seen.targetWords).toBe(5 * PARAMS.audioWordsPerMinute);
  });

  it('readability floor: a tiny budget yields a few full, explained stories', async () => {
    const repo = await seed(
      upsert({ id: 'a', title: 'Alpha', significance: 9, whyItMatters: 'Alpha fully explained.' }),
      upsert({ id: 'b', title: 'Bravo', significance: 8, whyItMatters: 'Bravo fully explained.' }),
      upsert({ id: 'c', title: 'Charlie', significance: 7, whyItMatters: 'Charlie fully explained.' }),
      upsert({ id: 'd', title: 'Delta', significance: 6, whyItMatters: 'Delta fully explained.' }),
    );
    const floored = { ...PARAMS, minDepth: 'full' as const, minStories: 3 };
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: floored });

    const brief = await q.textBrief({ minutes: 1 }); // tiny budget

    expect(brief).toContain('3 stories'); // floored to 3, not a dozen headlines
    expect(brief).toContain('Alpha fully explained.'); // each one carries its context
    expect(brief).toContain('Charlie fully explained.');
    expect(brief).not.toContain('Delta'); // 4th dropped — fewer but readable
  });

  it('podcastScript falls back to the deterministic brief when narration fails', async () => {
    const repo = await seed(upsert({ id: 'a', title: 'Alpha', significance: 9 }));
    const llm = new FakeLLM({ narrate: '' }); // resilient client returns '' on failure
    const q = new HorizonQuery({ storyRepo: repo, llm, params: PARAMS });

    const script = await q.podcastScript({ minutes: 5 });

    expect(script).toContain('Alpha');
    expect(script.length).toBeGreaterThan(0);
  });

  describe('briefStories (ADR-0064 — structured brief with the score breakdown)', () => {
    it('returns the same selection as textBrief with each story\'s interpreted drivers', async () => {
      const repo = await seed(
        upsert({
          id: 'a',
          title: 'Alpha',
          topic: 'AI',
          significance: 9,
          summary: 'What happened.',
          whyItMatters: 'Why it matters here.',
          url: 'https://example.com/a',
          scoreBreakdown: {
            base: 9,
            recencyFactor: 1,
            impact: 0.9,
            components: [
              { key: 'impact', value: 0.9 },
              { key: 'corroboration', value: 0.7 },
              { key: 'authority', value: 0.7 },
              { key: 'attention', value: 0.2 },
            ],
            signalNudge: 0.3,
            signals: {
              points: 0, mentions: 0, tone: 0, sourceWeight: 0.7, ageHours: 0, corroboration: 4,
            },
          },
        }),
        upsert({ id: 'b', title: 'Bravo', significance: 4 }), // no breakdown
      );
      const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: { ...PARAMS, minDepth: 'full' } });

      const stories = await q.briefStories({ minutes: 5 });

      expect(stories.map((s) => s.title)).toEqual(['Alpha', 'Bravo']); // significance order
      const alpha = stories[0]!;
      expect(alpha.drivers[0]).toEqual({ key: 'impact', label: 'Real-world impact', value: 0.9 }); // strongest first
      expect(alpha.tags).toContain('major real-world impact');
      expect(alpha.corroboration).toBe(4);
      expect(alpha.signalNudge).toBeCloseTo(0.3, 5);
      expect(alpha.whyItMatters).toBe('Why it matters here.'); // full depth
      // A pre-breakdown story degrades to an empty, non-throwing breakdown.
      expect(stories[1]!.drivers).toEqual([]);
      expect(stories[1]!.tags).toEqual([]);
    });

    it('omits why-it-matters below full depth, matching the text brief', async () => {
      const repo = await seed(
        upsert({ id: 'a', title: 'Alpha', significance: 9, summary: 'One. Two. Three.', whyItMatters: 'Hidden at brief depth.' }),
      );
      const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

      const [story] = await q.briefStories({ minutes: 1 }); // brief depth (20-word budget)

      expect(story?.summary).toBe('One. Two.'); // trimmed to two sentences
      expect(story?.whyItMatters).toBeNull(); // not full depth
    });
  });

  // --- Product-intent guarantees (the pillars, made checkable) ---

  describe('intent: all your fields, one concentrated place', () => {
    it('an unfiltered brief spans many topics — not one field crowding out the rest', async () => {
      // One story per field, all similarly significant: the default (no topic
      // filter, no weights) brief should surface the breadth, not collapse to a
      // single topic. This is the "everything you follow, in one place" promise.
      const repo = await seed(
        upsert({ id: 'ai', title: 'AI story', topic: 'AI', significance: 8 }),
        upsert({ id: 'geo', title: 'Geopolitics story', topic: 'Geopolitics', significance: 8 }),
        upsert({ id: 'biz', title: 'Business story', topic: 'Business', significance: 8 }),
        upsert({ id: 'sci', title: 'Science story', topic: 'Science', significance: 8 }),
        upsert({ id: 'spo', title: 'Sports story', topic: 'Sports', significance: 8 }),
        upsert({ id: 'isr', title: 'Israel story', topic: 'Israel', significance: 8 }),
      );
      const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

      const stories = await q.briefStories({ minutes: 10 }); // generous budget: room for all

      const topics = new Set(stories.map((s) => s.topic));
      expect(topics.size).toBeGreaterThanOrEqual(4); // genuinely multi-field
    });
  });

  describe('intent: audio or text — the same digest, two formats', () => {
    it('the podcast narrates the same ranked selection the text brief shows', async () => {
      // FakeLLM.narrate echoes back the brief it is handed, so the narrated
      // input reveals the podcast's selection. At a budget where both formats
      // fit every story, the two surfaces must cover the same stories in the
      // same significance order — one digest, rendered as text or as audio.
      const repo = await seed(
        upsert({ id: 'a', title: 'Alpha', significance: 9 }),
        upsert({ id: 'b', title: 'Bravo', significance: 7 }),
        upsert({ id: 'c', title: 'Charlie', significance: 5 }),
      );
      let narratedBrief = '';
      const llm = new FakeLLM({
        narrate: (input) => {
          narratedBrief = input.brief;
          return 'SPOKEN';
        },
      });
      const q = new HorizonQuery({ storyRepo: repo, llm, params: PARAMS });

      const text = await q.textBrief({ minutes: 20 }); // ample for all three in both formats
      await q.podcastScript({ minutes: 20 });

      for (const title of ['Alpha', 'Bravo', 'Charlie']) {
        expect(text).toContain(title);
        expect(narratedBrief).toContain(title);
      }
      // Same ranking on both surfaces.
      expect(narratedBrief.indexOf('Alpha')).toBeLessThan(narratedBrief.indexOf('Bravo'));
      expect(narratedBrief.indexOf('Bravo')).toBeLessThan(narratedBrief.indexOf('Charlie'));
    });
  });
});
