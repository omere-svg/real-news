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
      regions: ['Israel'],
      defaultMinutes: 12,
    });
    expect(saved).toEqual({
      chatId: 42,
      topics: ['AI', 'Geopolitics'],
      regions: ['Israel'],
      defaultMinutes: 12,
    });
    expect(await repo.get(42)).toEqual(saved);
  });

  it('merges a partial patch over existing preferences', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    await repo.set(42, { topics: ['AI'], defaultMinutes: 5 });
    await repo.set(42, { regions: ['World'] }); // patch leaves topics/minutes intact

    expect(await repo.get(42)).toEqual({
      chatId: 42,
      topics: ['AI'],
      regions: ['World'],
      defaultMinutes: 5,
    });
  });

  it('clear removes the chat so it falls back to defaults', async () => {
    const repo = new DrizzleChatPreferencesRepo(await createTestDb());
    await repo.set(42, { topics: ['AI'] });
    await repo.clear(42);
    expect(await repo.get(42)).toBeNull();
  });
});
