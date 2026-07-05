import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../src/pipeline/concurrency.js';

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('returns an empty array for empty input (no workers spawned)', async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it('never exceeds the concurrency limit of in-flight tasks', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually ran in parallel
  });

  it('runs each item exactly once', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([0, 1, 2, 3], 8, async (i) => {
      seen.push(i);
      return i;
    });
    expect(seen.sort()).toEqual([0, 1, 2, 3]);
  });
});
