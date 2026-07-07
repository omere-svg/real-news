import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleChatSessionRepo } from '../../src/db/chat-session-repo.js';

describe('DrizzleChatSessionRepo (ADR-0053)', () => {
  it('persists and reads back a chat conversation, replacing on put', async () => {
    const repo = new DrizzleChatSessionRepo(await createTestDb());

    await repo.put(5, [{ role: 'user', content: 'hi' }], 1000);
    await repo.put(
      5,
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      2000,
    );

    expect(await repo.turns(5)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(await repo.turns(999)).toEqual([]); // unknown chat
  });

  it('prunes sessions idle since before the cutoff', async () => {
    const repo = new DrizzleChatSessionRepo(await createTestDb());
    await repo.put(1, [{ role: 'user', content: 'old' }], 1000);
    await repo.put(2, [{ role: 'user', content: 'fresh' }], 5000);

    expect(await repo.pruneIdleSince(3000)).toBe(1);
    expect(await repo.turns(1)).toEqual([]);
    expect(await repo.turns(2)).toHaveLength(1);
  });
});
