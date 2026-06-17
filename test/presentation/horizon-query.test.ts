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
    region: 'World',
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

  it('topicOutline groups the topic by region and excludes other topics', async () => {
    const repo = await seed(
      upsert({ id: 'w', title: 'World AI', region: 'World', topic: 'AI', significance: 8 }),
      upsert({ id: 'i', title: 'Israel AI', region: 'Israel', topic: 'AI', significance: 7 }),
      upsert({ id: 'p', title: 'World Politics', region: 'World', topic: 'Politics', significance: 9 }),
    );
    const q = new HorizonQuery({ storyRepo: repo, llm: new FakeLLM(), params: PARAMS });

    const outline = await q.topicOutline('AI', { minutes: 10 });

    expect(outline).toContain('AI outline');
    expect(outline).toContain('World');
    expect(outline).toContain('Israel');
    expect(outline).toContain('World AI');
    expect(outline).toContain('Israel AI');
    expect(outline).not.toContain('World Politics');
  });

  it('podcastScript narrates the budgeted brief via the deep tier', async () => {
    const repo = await seed(upsert({ id: 'a', title: 'Alpha', significance: 9 }));
    let seenBrief = '';
    const llm = new FakeLLM({
      narrate: ({ brief }) => {
        seenBrief = brief;
        return 'SPOKEN SCRIPT';
      },
    });
    const q = new HorizonQuery({ storyRepo: repo, llm, params: PARAMS });

    const script = await q.podcastScript({ minutes: 5 });

    expect(script).toBe('SPOKEN SCRIPT');
    expect(llm.narrateCalls).toBe(1);
    expect(seenBrief).toContain('Alpha'); // narration is built from the brief
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
});
