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

  it('sweeps expired windows so the map cannot grow unbounded (ADR-0050)', () => {
    const limiter = new FixedWindowLimiter(5, 1000);
    // Fill past the sweep floor with one-off keys, all in the same instant.
    for (let i = 0; i < 300; i += 1) limiter.allow('chat:' + i, 0);
    const size = (limiter as unknown as { windows: Map<string, unknown> }).windows;
    expect(size.size).toBe(300);
    // Long after every window expired, a new key triggers a sweep of the stale ones.
    limiter.allow('chat:new', 10_000);
    expect(size.size).toBe(1); // 300 expired windows dropped, only the fresh key remains
  });
});
