import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleRawItemRepo } from '../../src/db/raw-item-repo.js';
import { DrizzleStoryRepo } from '../../src/db/story-repo.js';
import { FakeClock } from '../helpers/fake-clock.js';
import type { RawItem } from '../../src/domain/types.js';

function rawItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    source: 'hackernews',
    externalId: '1',
    title: 'A title',
    url: 'https://example.com',
    text: null,
    publishedAt: null,
    metadata: {},
    ...overrides,
  };
}

describe('RawItemRepo', () => {
  it('round-trips: upsert then get returns the item', async () => {
    const db = await createTestDb();
    const repo = new DrizzleRawItemRepo(db);

    const item = rawItem();
    await repo.upsert([item]);

    const found = await repo.get({ source: 'hackernews', externalId: '1' });
    expect(found).toEqual(item);
  });

  it('is idempotent: re-upserting the same (source, externalId) does not duplicate', async () => {
    const db = await createTestDb();
    const repo = new DrizzleRawItemRepo(db);

    await repo.upsert([rawItem()]);
    await repo.upsert([rawItem()]);

    expect(await repo.all()).toHaveLength(1);
  });

  it('updates mutable fields in place on re-upsert (the Active Editor)', async () => {
    const db = await createTestDb();
    const repo = new DrizzleRawItemRepo(db);

    await repo.upsert([
      rawItem({ title: 'Old title', metadata: { points: 10 } }),
    ]);
    await repo.upsert([
      rawItem({ title: 'New title', metadata: { points: 200 } }),
    ]);

    const found = await repo.get({ source: 'hackernews', externalId: '1' });
    expect(found?.title).toBe('New title');
    expect(found?.metadata.points).toBe(200);
    expect(await repo.all()).toHaveLength(1);
  });

  it('treats the same externalId from different sources as distinct items', async () => {
    const db = await createTestDb();
    const repo = new DrizzleRawItemRepo(db);

    await repo.upsert([
      rawItem({ source: 'hackernews', externalId: 'X' }),
      rawItem({ source: 'arxiv', externalId: 'X' }),
    ]);

    expect(await repo.all()).toHaveLength(2);
    expect(await repo.get({ source: 'hackernews', externalId: 'X' })).not.toBeNull();
    expect(await repo.get({ source: 'arxiv', externalId: 'X' })).not.toBeNull();
  });

  it('pruneUnreferenced deletes only raw_items no story references (ADR-0047)', async () => {
    const db = await createTestDb();
    const repo = new DrizzleRawItemRepo(db);
    const storyRepo = new DrizzleStoryRepo(db, new FakeClock(1000));

    await repo.upsert([
      rawItem({ source: 'hackernews', externalId: 'kept' }),
      rawItem({ source: 'hackernews', externalId: 'orphan' }),
    ]);
    // A story references only the 'kept' item.
    await storyRepo.upsert({
      id: 's1',
      title: 'Kept',
      url: null,
      topic: 'AI',
      significance: 5,
      whyItMatters: null,
      memberRefs: [{ source: 'hackernews', externalId: 'kept' }],
    });

    const removed = await repo.pruneUnreferenced();
    expect(removed).toBe(1);
    expect(await repo.get({ source: 'hackernews', externalId: 'kept' })).not.toBeNull();
    expect(await repo.get({ source: 'hackernews', externalId: 'orphan' })).toBeNull();
  });
});
