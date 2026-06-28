import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleChatPreferencesRepo } from '../../src/db/chat-preferences-repo.js';

describe('ChatPreferencesRepo', () => {
  it('returns null for a chat with no saved preferences', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    expect(await repo.get(42)).toBeNull();
  });

  it('sets and reads back preferences', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    const saved = await repo.set(42, {
      topics: ['AI', 'Geopolitics'],
      defaultMinutes: 12,
    });
    expect(saved).toEqual({
      chatId: 42,
      topics: ['AI', 'Geopolitics'],
      defaultMinutes: 12,
    });
    expect(await repo.get(42)).toEqual(saved);
  });

  it('merges a partial patch over existing preferences', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    await repo.set(42, { topics: ['AI'], defaultMinutes: 5 });
    await repo.set(42, { topics: ['Israel'] }); // patch leaves minutes intact

    expect(await repo.get(42)).toEqual({
      chatId: 42,
      topics: ['Israel'],
      defaultMinutes: 5,
    });
  });

  it('isolates one chat from another (no cross-chat leakage)', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    await repo.set(1, { topics: ['AI'], defaultMinutes: 9 });

    expect(await repo.get(2)).toBeNull(); // chat 2 sees nothing of chat 1
    await repo.set(2, { topics: ['Sports'] });
    expect((await repo.get(1))?.topics).toEqual(['AI']); // chat 1 unaffected by chat 2
    expect((await repo.get(2))?.defaultMinutes).toBeUndefined(); // chat 2 didn't inherit chat 1
  });

  it('round-trips feedback weights and the undo snapshot (ADR-0026)', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    const saved = await repo.set(42, {
      topicWeights: { AI: 1.5, Sports: 0 },
      prev: { topicWeights: { AI: 1 }, defaultMinutes: 3 },
    });
    expect(saved.topicWeights).toEqual({ AI: 1.5, Sports: 0 });
    expect(await repo.get(42)).toEqual(saved);

    // A later patch leaves the weights intact (merge semantics).
    await repo.set(42, { defaultMinutes: 7 });
    const got = await repo.get(42);
    expect(got?.topicWeights).toEqual({ AI: 1.5, Sports: 0 });
    expect(got?.defaultMinutes).toBe(7);
  });

  it('round-trips free-text memory and merges it independently (ADR-0028)', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    await repo.set(42, { memory: 'I run a logistics startup in Haifa.' });
    expect((await repo.get(42))?.memory).toBe('I run a logistics startup in Haifa.');

    // A later unrelated patch leaves the memory intact (merge semantics).
    await repo.set(42, { topics: ['AI'] });
    expect((await repo.get(42))?.memory).toBe('I run a logistics startup in Haifa.');

    // Setting memory to undefined clears it back to none.
    await repo.set(42, { memory: undefined });
    expect((await repo.get(42))?.memory).toBeUndefined();
  });

  it('clear removes the chat so it falls back to defaults', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    await repo.set(42, { topics: ['AI'] });
    await repo.clear(42);
    expect(await repo.get(42)).toBeNull();
  });
});
