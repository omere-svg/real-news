import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { DrizzleRawItemRepo } from '../../src/db/raw-item-repo.js';
import { backfillSummaries } from '../../src/pipeline/backfill-summaries.js';
import type { RawItem } from '../../src/domain/types.js';

function rawItem(externalId: string, over: Partial<RawItem> = {}): RawItem {
  return {
    source: 'hackernews',
    externalId,
    title: `Item ${externalId}`,
    url: null,
    text: null,
    publishedAt: null,
    metadata: {},
    ...over,
  };
}

async function setup() {
  const db = await createTestDb();
  const storyRepo = new DrizzleStoryRepo(db, new FakeClock(1000));
  const rawItemRepo = new DrizzleRawItemRepo(db);
  return { storyRepo, rawItemRepo };
}

describe('backfillSummaries', () => {
  it('fills summary + whyItMatters only for stories missing a summary', async () => {
    const { storyRepo, rawItemRepo } = await setup();
    await rawItemRepo.upsert([rawItem('1', { title: 'Quake hits coast', text: 'Magnitude 6.' })]);
    await storyRepo.upsert({
      id: 'stale', title: 'Quake', url: null, topic: 'Geopolitics',
      significance: 8, whyItMatters: 'old verbose text', memberRefs: [{ source: 'hackernews', externalId: '1' }],
    });
    await storyRepo.upsert({
      id: 'fresh', title: 'Already done', url: null, topic: 'AI',
      significance: 9, summary: 'Keep me.', whyItMatters: 'Keep this too.',
      memberRefs: [{ source: 'hackernews', externalId: '2' }],
    });

    const llm = new FakeLLM();
    const res = await backfillSummaries({ storyRepo, rawItemRepo, llm }, {});

    expect(res).toEqual({ processed: 1, total: 1 }); // only the stale one
    const stale = await storyRepo.get('stale');
    expect(stale?.summary).toContain('Quake hits coast'); // analyzed from the representative raw item
    expect(stale?.whyItMatters).not.toBe('old verbose text'); // regenerated
    const fresh = await storyRepo.get('fresh');
    expect(fresh?.summary).toBe('Keep me.'); // untouched
  });

  it('all: redoes every story regardless of existing summary', async () => {
    const { storyRepo, rawItemRepo } = await setup();
    await storyRepo.upsert({
      id: 'a', title: 'A', url: null, topic: 'AI',
      significance: 5, summary: 'old', whyItMatters: 'old',
      memberRefs: [],
    });

    const llm = new FakeLLM({ analyze: { summary: 'NEW', whyItMatters: 'NEW WHY' } });
    const res = await backfillSummaries({ storyRepo, rawItemRepo, llm }, { all: true });

    expect(res.processed).toBe(1);
    const a = await storyRepo.get('a');
    expect(a?.summary).toBe('NEW');
    expect(a?.whyItMatters).toBe('NEW WHY');
  });

  it('caps the number processed and takes the most significant first', async () => {
    const { storyRepo, rawItemRepo } = await setup();
    for (const [id, sig] of [['low', 2], ['high', 9], ['mid', 5]] as const) {
      await storyRepo.upsert({
        id, title: id, url: null, topic: 'AI',
        significance: sig, whyItMatters: null, memberRefs: [],
      });
    }

    const llm = new FakeLLM();
    const res = await backfillSummaries({ storyRepo, rawItemRepo, llm }, { max: 1 });

    expect(res).toEqual({ processed: 1, total: 1 });
    expect((await storyRepo.get('high'))?.summary).toBeTruthy(); // most significant healed
    expect((await storyRepo.get('low'))?.summary).toBeNull(); // skipped by the cap
  });
});
