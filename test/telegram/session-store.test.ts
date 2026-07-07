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
});
