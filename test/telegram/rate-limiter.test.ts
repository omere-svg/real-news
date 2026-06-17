import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../../src/telegram/rate-limiter.js';

describe('FixedWindowLimiter', () => {
  it('allows up to capacity within a window, then blocks', () => {
    const limiter = new FixedWindowLimiter(3, 60_000);
    expect(limiter.allow('chat:1', 0)).toBe(true);
    expect(limiter.allow('chat:1', 10)).toBe(true);
    expect(limiter.allow('chat:1', 20)).toBe(true);
    expect(limiter.allow('chat:1', 30)).toBe(false); // 4th in the window
  });

  it('resets after the window elapses', () => {
    const limiter = new FixedWindowLimiter(2, 60_000);
    expect(limiter.allow('chat:1', 0)).toBe(true);
    expect(limiter.allow('chat:1', 100)).toBe(true);
    expect(limiter.allow('chat:1', 200)).toBe(false);
    expect(limiter.allow('chat:1', 60_001)).toBe(true); // new window
  });

  it('tracks each key independently', () => {
    const limiter = new FixedWindowLimiter(1, 60_000);
    expect(limiter.allow('chat:1', 0)).toBe(true);
    expect(limiter.allow('chat:2', 0)).toBe(true); // different key, own budget
    expect(limiter.allow('chat:1', 1)).toBe(false);
  });
});
