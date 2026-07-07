import { describe, expect, it } from 'vitest';
import { withTimeout } from '../../src/scheduler/timeout.js';

describe('withTimeout (ADR-0054 audit fix: bounded graceful shutdown)', () => {
  it('resolves with the promise value when it settles before the cap', async () => {
    const result = await withTimeout(Promise.resolve('done'), 50);
    expect(result).toBe('done');
  });

  it('shutdown completes even if lock release hangs', async () => {
    const hung = new Promise<void>(() => {
      /* never resolves — simulates a hung lock.release() */
    });
    const start = Date.now();
    await withTimeout(hung, 20);
    expect(Date.now() - start).toBeLessThan(500); // resolved by the cap, not hung forever
  });

  it('propagates rejection from the underlying promise when it rejects before the cap', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 50)).rejects.toThrow('nope');
  });
});
