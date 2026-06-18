import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import type { StoryUpsert } from '../../src/db/story-repo.js';

function storyUpsert(overrides: Partial<StoryUpsert> = {}): StoryUpsert {
  return {
    id: 's1',
    title: 'A story',
    url: null,
    region: 'World',
    topic: 'AI',
    significance: 5,
    whyItMatters: null,
    memberRefs: [{ source: 'hackernews', externalId: '1' }],
    ...overrides,
  };
}

describe('StoryRepo', () => {
  it('creates a story and returns it with its member refs and timestamps', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));

    await repo.upsert(
      storyUpsert({
        memberRefs: [
          { source: 'hackernews', externalId: '1' },
          { source: 'gdelt', externalId: '2' },
        ],
      }),
    );

    const found = await repo.get('s1');
    expect(found).not.toBeNull();
    expect(found?.memberRefs).toHaveLength(2);
    expect(found?.firstSeenAt).toBe(1000);
    expect(found?.updatedAt).toBe(1000);
  });

  it('updates in place on re-upsert: bumps updatedAt, preserves firstSeenAt', async () => {
    const db = await createTestDb();
    const clock = new FakeClock(1000);
    const repo = new DrizzleStoryRepo(db, clock);

    await repo.upsert(storyUpsert({ significance: 5, whyItMatters: null }));

    clock.set(5000);
    await repo.upsert(
      storyUpsert({ significance: 8.2, whyItMatters: 'Now it matters.' }),
    );

    const found = await repo.get('s1');
    expect(await repo.all()).toHaveLength(1); // updated, not duplicated
    expect(found?.significance).toBe(8.2);
    expect(found?.whyItMatters).toBe('Now it matters.');
    expect(found?.firstSeenAt).toBe(1000); // preserved
    expect(found?.updatedAt).toBe(5000); // bumped
  });

  it('corroboration: adding a member from a new source raises the distinct-source count', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));

    const distinctSources = (story: { memberRefs: readonly { source: string }[] }) =>
      new Set(story.memberRefs.map((r) => r.source)).size;

    const one = await repo.upsert(
      storyUpsert({ memberRefs: [{ source: 'hackernews', externalId: '1' }] }),
    );
    expect(distinctSources(one)).toBe(1);

    const two = await repo.upsert(
      storyUpsert({
        memberRefs: [
          { source: 'hackernews', externalId: '1' },
          { source: 'gdelt', externalId: '2' },
        ],
      }),
    );
    expect(distinctSources(two)).toBe(2);
  });

  it('reassigns a member ref across stories without a primary-key collision', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));

    // Tick 1: source item hackernews:42 corroborates story A.
    await repo.upsert(
      storyUpsert({ id: 'a', memberRefs: [{ source: 'hackernews', externalId: '42' }] }),
    );

    // Tick 2: clustering reassigns the same source item to story B.
    // The ref still belongs to A, so a naive insert hits the (source, externalId) PK.
    await repo.upsert(
      storyUpsert({ id: 'b', memberRefs: [{ source: 'hackernews', externalId: '42' }] }),
    );

    // The ref now belongs to B alone — moved, not duplicated.
    const a = await repo.get('a');
    const b = await repo.get('b');
    expect(b?.memberRefs).toContainEqual({ source: 'hackernews', externalId: '42' });
    expect(a?.memberRefs).toHaveLength(0);
  });

  describe('topStories', () => {
    async function seed() {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
      await repo.upsert(
        storyUpsert({
          id: 'a',
          region: 'World',
          topic: 'AI',
          significance: 9,
          memberRefs: [{ source: 'hackernews', externalId: 'a1' }],
        }),
      );
      await repo.upsert(
        storyUpsert({
          id: 'b',
          region: 'Israel',
          topic: 'Politics',
          significance: 4,
          memberRefs: [{ source: 'gdelt', externalId: 'b1' }],
        }),
      );
      await repo.upsert(
        storyUpsert({
          id: 'c',
          region: 'World',
          topic: 'AI',
          significance: 7,
          memberRefs: [{ source: 'arxiv', externalId: 'c1' }],
        }),
      );
      return repo;
    }

    it('orders by significance descending', async () => {
      const repo = await seed();
      const top = await repo.topStories({});
      expect(top.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    });

    it('filters by region and topic', async () => {
      const repo = await seed();
      const top = await repo.topStories({ region: 'World', topic: 'AI' });
      expect(top.map((s) => s.id)).toEqual(['a', 'c']);
    });

    it('filters by region/topic arrays (IN-list)', async () => {
      const repo = await seed();
      const top = await repo.topStories({
        region: ['World', 'Israel'],
        topic: ['AI', 'Politics'],
      });
      expect(top.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    });

    it('treats an empty filter array as no filter', async () => {
      const repo = await seed();
      const top = await repo.topStories({ topic: [] });
      expect(top.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    });

    it('respects minSignificance and limit', async () => {
      const repo = await seed();
      expect(
        (await repo.topStories({ minSignificance: 5 })).map((s) => s.id),
      ).toEqual(['a', 'c']);
      expect((await repo.topStories({ limit: 1 })).map((s) => s.id)).toEqual([
        'a',
      ]);
    });
  });

  describe('vectors (cross-tick dedup, ADR-0017)', () => {
    it('stores and reads back a representative vector for a story', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
      await repo.upsert(storyUpsert({ id: 'a', region: 'World', topic: 'AI' }));

      await repo.putVector('a', [0.1, 0.2, 0.3]);
      await repo.putVector('a', [1, 0, 0]); // overwrites in place

      const got = await repo.recentVectors({
        region: 'World',
        topic: 'AI',
        sinceMs: 0,
      });
      expect(got).toEqual([{ storyId: 'a', vector: [1, 0, 0] }]);
    });

    it('recentVectors blocks by region/topic and the recency window', async () => {
      const db = await createTestDb();
      const clock = new FakeClock(5000);
      const repo = new DrizzleStoryRepo(db, clock);
      await repo.upsert(
        storyUpsert({
          id: 'ai',
          region: 'World',
          topic: 'AI',
          memberRefs: [{ source: 'hackernews', externalId: 'ai1' }],
        }),
      );
      await repo.upsert(
        storyUpsert({
          id: 'pol',
          region: 'World',
          topic: 'Politics',
          memberRefs: [{ source: 'gdelt', externalId: 'pol1' }],
        }),
      );
      await repo.putVector('ai', [1, 0, 0]);
      await repo.putVector('pol', [0, 1, 0]);

      const aiOnly = await repo.recentVectors({
        region: 'World',
        topic: 'AI',
        sinceMs: 0,
      });
      expect(aiOnly.map((v) => v.storyId)).toEqual(['ai']);

      const tooOld = await repo.recentVectors({
        region: 'World',
        topic: 'AI',
        sinceMs: 6000, // story updatedAt=5000 is older than the window
      });
      expect(tooOld).toEqual([]);
    });
  });
});
