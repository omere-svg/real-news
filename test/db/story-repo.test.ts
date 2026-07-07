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

  it('existingAnalysis returns summary/why for known ids only (ADR-0047)', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
    await repo.upsert(storyUpsert({ id: 's1', summary: 'Sum one', whyItMatters: 'Why one' }));
    await repo.upsert(storyUpsert({ id: 's2', summary: null, whyItMatters: null,
      memberRefs: [{ source: 'gdelt', externalId: '9' }] }));

    const map = await repo.existingAnalysis(['s1', 's2', 'missing']);
    expect(map.get('s1')).toEqual({ summary: 'Sum one', whyItMatters: 'Why one' });
    expect(map.get('s2')).toEqual({ summary: null, whyItMatters: null });
    expect(map.has('missing')).toBe(false);
    expect(await repo.existingAnalysis([])).toEqual(new Map()); // empty input, no query
  });

  it('persists and returns the score breakdown; defaults to null when omitted (ADR-0032)', async () => {
    const db = await createTestDb();
    const repo = new DrizzleStoryRepo(db, new FakeClock(1000));

    expect((await repo.upsert(storyUpsert())).scoreBreakdown).toBeNull();

    const breakdown = {
      base: 6,
      recencyFactor: 0.7,
      components: [
        { key: 'impact' as const, value: 0.8 },
        { key: 'corroboration' as const, value: 0.6 },
        { key: 'authority' as const, value: 0.7 },
        { key: 'attention' as const, value: 0.2 },
      ],
      impact: 0.8,
      signalNudge: 0,
      signals: {
        points: 100,
        mentions: 0,
        tone: 0,
        sourceWeight: 0.7,
        ageHours: 24,
        corroboration: 4,
      },
    };
    await repo.upsert(storyUpsert({ id: 's2', significance: 7, scoreBreakdown: breakdown }));

    const found = await repo.get('s2');
    expect(found?.scoreBreakdown).toEqual(breakdown);
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
          topic: 'AI',
          significance: 9,
          memberRefs: [{ source: 'hackernews', externalId: 'a1' }],
        }),
      );
      await repo.upsert(
        storyUpsert({
          id: 'b',
          topic: 'Politics',
          significance: 4,
          memberRefs: [{ source: 'gdelt', externalId: 'b1' }],
        }),
      );
      await repo.upsert(
        storyUpsert({
          id: 'c',
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

    it('filters by topic', async () => {
      const repo = await seed();
      const top = await repo.topStories({ topic: 'AI' });
      expect(top.map((s) => s.id)).toEqual(['a', 'c']);
    });

    it('filters by topic arrays (IN-list)', async () => {
      const repo = await seed();
      const top = await repo.topStories({
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
      await repo.upsert(storyUpsert({ id: 'a', topic: 'AI' }));

      await repo.putVector('a', [0.1, 0.2, 0.3]);
      await repo.putVector('a', [1, 0, 0]); // overwrites in place

      const got = await repo.recentVectors({
        topic: 'AI',
        sinceMs: 0,
      });
      expect(got).toEqual([{ storyId: 'a', vector: [1, 0, 0] }]);
    });

    it('vectorsFor returns the stored vectors for exactly the requested ids (ADR-0053)', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
      await repo.upsert(storyUpsert({ id: 'a', topic: 'AI' }));
      await repo.upsert(storyUpsert({ id: 'b', topic: 'AI' }));
      await repo.upsert(storyUpsert({ id: 'c', topic: 'AI' }));
      await repo.putVector('a', [1, 0]);
      await repo.putVector('b', [0, 1]);
      // 'c' has no vector; 'zzz' does not exist.

      const got = await repo.vectorsFor(['a', 'c', 'zzz']);

      expect(got.get('a')).toEqual([1, 0]);
      expect(got.has('b')).toBe(false); // not requested
      expect(got.has('c')).toBe(false); // no vector stored
      expect(got.size).toBe(1);
    });

    it('vectorsFor is empty for an empty id list without querying', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
      expect((await repo.vectorsFor([])).size).toBe(0);
    });

    it('recentVectors blocks by topic and the recency window', async () => {
      const db = await createTestDb();
      const clock = new FakeClock(5000);
      const repo = new DrizzleStoryRepo(db, clock);
      await repo.upsert(
        storyUpsert({
          id: 'ai',
          topic: 'AI',
          memberRefs: [{ source: 'hackernews', externalId: 'ai1' }],
        }),
      );
      await repo.upsert(
        storyUpsert({
          id: 'pol',
          topic: 'Politics',
          memberRefs: [{ source: 'gdelt', externalId: 'pol1' }],
        }),
      );
      await repo.putVector('ai', [1, 0, 0]);
      await repo.putVector('pol', [0, 1, 0]);

      const aiOnly = await repo.recentVectors({
        topic: 'AI',
        sinceMs: 0,
      });
      expect(aiOnly.map((v) => v.storyId)).toEqual(['ai']);

      const tooOld = await repo.recentVectors({
        topic: 'AI',
        sinceMs: 6000, // story updatedAt=5000 is older than the window
      });
      expect(tooOld).toEqual([]);
    });

    it('semanticSearch ranks stories by cosine similarity to the query vector (ADR-0045)', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(5000));
      await repo.upsert(storyUpsert({ id: 'a', topic: 'AI', memberRefs: [{ source: 'hackernews', externalId: 'a1' }] }));
      await repo.upsert(storyUpsert({ id: 'b', topic: 'AI', memberRefs: [{ source: 'hackernews', externalId: 'b1' }] }));
      await repo.upsert(storyUpsert({ id: 'c', topic: 'AI', memberRefs: [{ source: 'hackernews', externalId: 'c1' }] }));
      await repo.putVector('a', [1, 0, 0]);
      await repo.putVector('b', [0.9, 0.1, 0]); // closest to the query
      await repo.putVector('c', [0, 1, 0]); // orthogonal

      const ranked = await repo.semanticSearch({ vector: [1, 0, 0], limit: 2 });
      expect(ranked.map((s) => s.id)).toEqual(['a', 'b']); // most similar first, capped

      const floored = await repo.semanticSearch({ vector: [1, 0, 0], limit: 5, minSimilarity: 0.5 });
      expect(floored.map((s) => s.id)).not.toContain('c'); // orthogonal filtered out
      expect(floored.every((s) => s.memberRefs.length > 0)).toBe(true); // hydrated
    });

    it('semanticSearch filters by topic', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(5000));
      await repo.upsert(storyUpsert({ id: 'ai', topic: 'AI', memberRefs: [{ source: 'hackernews', externalId: 'a1' }] }));
      await repo.upsert(storyUpsert({ id: 'clm', topic: 'Climate', memberRefs: [{ source: 'gdelt', externalId: 'c1' }] }));
      await repo.putVector('ai', [1, 0, 0]);
      await repo.putVector('clm', [1, 0, 0]);

      const aiOnly = await repo.semanticSearch({ vector: [1, 0, 0], limit: 5, topic: 'AI' });
      expect(aiOnly.map((s) => s.id)).toEqual(['ai']);
    });

    it('recentVectors with no topic returns all topics in the window (cross-topic, ADR-0038)', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(5000));
      await repo.upsert(
        storyUpsert({ id: 'ai', topic: 'AI', memberRefs: [{ source: 'hackernews', externalId: 'ai1' }] }),
      );
      await repo.upsert(
        storyUpsert({ id: 'clm', topic: 'Climate', memberRefs: [{ source: 'gdelt', externalId: 'c1' }] }),
      );
      await repo.putVector('ai', [1, 0, 0]);
      await repo.putVector('clm', [0, 1, 0]);

      const all = await repo.recentVectors({ sinceMs: 0 });
      expect(new Set(all.map((v) => v.storyId))).toEqual(new Set(['ai', 'clm']));
    });
  });

  describe('pruneOrphans (ADR-0038)', () => {
    it('deletes stories with no members (and their vectors), keeps the rest', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(1000));

      // Two stories; move the shared member from A to B so A is left member-less.
      await repo.upsert(storyUpsert({ id: 'a', memberRefs: [{ source: 'hackernews', externalId: '42' }] }));
      await repo.putVector('a', [1, 0, 0]);
      await repo.upsert(storyUpsert({ id: 'b', memberRefs: [{ source: 'hackernews', externalId: '42' }] }));
      await repo.putVector('b', [0, 1, 0]);

      expect((await repo.get('a'))?.memberRefs).toHaveLength(0); // orphaned

      const pruned = await repo.pruneOrphans();

      expect(pruned).toBe(1);
      expect(await repo.get('a')).toBeNull(); // gone
      expect(await repo.get('b')).not.toBeNull(); // kept
      // A's vector is gone; B's vector survives.
      const vectors = await repo.recentVectors({ sinceMs: 0 });
      expect(vectors.map((v) => v.storyId)).toEqual(['b']);
    });

    it('is a no-op when every story has members', async () => {
      const db = await createTestDb();
      const repo = new DrizzleStoryRepo(db, new FakeClock(1000));
      await repo.upsert(storyUpsert({ id: 'a', memberRefs: [{ source: 'hackernews', externalId: '1' }] }));
      expect(await repo.pruneOrphans()).toBe(0);
      expect(await repo.get('a')).not.toBeNull();
    });
  });
});
