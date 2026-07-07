import { describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/telegram/session-store.js';

describe('SessionStore (ADR-0052)', () => {
  it('creates an idle session on first contact and reuses it', () => {
    const s = new SessionStore();
    const a = s.get(1, 0);
    expect(a.mode).toBe('idle');
    a.mode = 'chat';
    expect(s.get(1, 1).mode).toBe('chat'); // same session returned
  });

  it('evicts sessions idle past the TTL when a new chat arrives', () => {
    const s = new SessionStore(1000); // 1s TTL
    s.get(1, 0);
    expect(s.has(1)).toBe(true);
    s.get(2, 2000); // 2s later, a new chat → chat 1 is swept
    expect(s.has(1)).toBe(false);
    expect(s.has(2)).toBe(true);
  });

  it('bounds conversation history to the most recent N turns', () => {
    const s = new SessionStore(3600_000, 2); // keep 2
    for (let i = 0; i < 5; i += 1) s.remember(1, i, { role: 'user', content: `m${i}` });
    expect(s.get(1, 6).history.map((t) => t.content)).toEqual(['m3', 'm4']);
  });

  describe('durable backing (ADR-0053)', () => {
    function fakeRepo(initial: Record<number, { role: 'user' | 'assistant'; content: string }[]> = {}) {
      const stored = new Map(Object.entries(initial).map(([k, v]) => [Number(k), v]));
      return {
        stored,
        turns: async (chatId: number) => stored.get(chatId) ?? [],
        put: async (chatId: number, turns: readonly { role: 'user' | 'assistant'; content: string }[]) => {
          stored.set(chatId, [...turns]);
        },
        pruneIdleSince: async () => 0,
      };
    }

    it('hydrates history from the durable store after a restart', async () => {
      const repo = fakeRepo({ 5: [{ role: 'user', content: 'before the deploy' }] });
      const s = new SessionStore(3600_000, 6, repo); // fresh process, empty memory

      const history = await s.history(5, 100);
      expect(history.map((t) => t.content)).toEqual(['before the deploy']);
    });

    it('writes turns through so the next process can pick the conversation up', async () => {
      const repo = fakeRepo();
      const s = new SessionStore(3600_000, 6, repo);

      s.remember(5, 100, { role: 'user', content: 'q1' });
      await Promise.resolve(); // let the fire-and-forget write land
      expect(repo.stored.get(5)?.map((t) => t.content)).toEqual(['q1']);
    });

    it('in-memory history wins once present (no double hydration)', async () => {
      const repo = fakeRepo({ 5: [{ role: 'user', content: 'stale persisted' }] });
      const s = new SessionStore(3600_000, 6, repo);
      s.remember(5, 100, { role: 'user', content: 'live turn' });

      const history = await s.history(5, 200);
      expect(history.map((t) => t.content)).toEqual(['live turn']);
    });
  });
});
