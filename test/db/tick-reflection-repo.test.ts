import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleTickReflectionRepo } from '../../src/db/tick-reflection-repo.js';

describe('TickReflectionRepo (ADR-0042)', () => {
  it('records advisories and reads them back newest first', async () => {
    const repo = new DrizzleTickReflectionRepo(await createTestDb());
    await repo.record({ createdAt: 100, ticksCovered: 5, text: 'first' });
    await repo.record({ createdAt: 300, ticksCovered: 5, text: 'latest' });
    await repo.record({ createdAt: 200, ticksCovered: 5, text: 'middle' });

    const recent = await repo.recent(2);
    expect(recent.map((r) => r.text)).toEqual(['latest', 'middle']);
    expect(recent[0]?.ticksCovered).toBe(5);
  });

  it('prunes to the most recent N', async () => {
    const repo = new DrizzleTickReflectionRepo(await createTestDb());
    for (let i = 1; i <= 6; i += 1) {
      await repo.record({ createdAt: i * 100, ticksCovered: 5, text: `r${i}` });
    }

    const removed = await repo.pruneToRecent(3);
    expect(removed).toBe(3);
    const kept = await repo.recent(10);
    expect(kept.map((r) => r.text)).toEqual(['r6', 'r5', 'r4']);
  });

  it('does not prune before the keep threshold is reached', async () => {
    const repo = new DrizzleTickReflectionRepo(await createTestDb());
    await repo.record({ createdAt: 100, ticksCovered: 5, text: 'only' });
    expect(await repo.pruneToRecent(5)).toBe(0);
    expect(await repo.recent(10)).toHaveLength(1);
  });
});
