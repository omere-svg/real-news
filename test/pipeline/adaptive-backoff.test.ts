import { describe, expect, it } from 'vitest';
import { AdaptiveBackoff } from '../../src/pipeline/adaptive-backoff.js';

describe('AdaptiveBackoff (observe→adapt loop, ADR-0052)', () => {
  const opts = { threshold: 3, cooldownTicks: 2 };

  it('backs off a source only after `threshold` consecutive failures', () => {
    const b = new AdaptiveBackoff(opts);
    expect(b.record(0, ['gdelt'], ['gdelt'])).toEqual([]); // 1
    expect(b.record(1, ['gdelt'], ['gdelt'])).toEqual([]); // 2
    expect(b.record(2, ['gdelt'], ['gdelt'])).toEqual(['gdelt']); // 3 → backed off
    expect(b.activeBackoffs(3).has('gdelt')).toBe(true);
  });

  it('skips a backed-off source during cooldown, then retries it', () => {
    const b = new AdaptiveBackoff(opts);
    for (let t = 0; t < 3; t += 1) b.record(t, ['gdelt'], ['gdelt']); // backed off at t=2, until t=2+2=4
    expect(b.activeBackoffs(3).has('gdelt')).toBe(true); // cooling down
    expect(b.activeBackoffs(4).has('gdelt')).toBe(true); // still (<=until)
    expect(b.activeBackoffs(5).has('gdelt')).toBe(false); // cooldown over → retried
  });

  it('a single success clears the streak (no premature backoff)', () => {
    const b = new AdaptiveBackoff(opts);
    b.record(0, ['gdelt'], ['gdelt']);
    b.record(1, ['gdelt'], ['gdelt']);
    b.record(2, ['gdelt'], []); // recovered → streak reset
    expect(b.record(3, ['gdelt'], ['gdelt'])).toEqual([]); // counts from 1 again, not backed off
    expect(b.activeBackoffs(4).has('gdelt')).toBe(false);
  });

  it('tracks sources independently', () => {
    const b = new AdaptiveBackoff({ threshold: 2, cooldownTicks: 1 });
    b.record(0, ['gdelt', 'arxiv'], ['gdelt']); // only gdelt fails
    const newly = b.record(1, ['gdelt', 'arxiv'], ['gdelt']);
    expect(newly).toEqual(['gdelt']);
    expect(b.activeBackoffs(2)).toEqual(new Set(['gdelt'])); // arxiv never backed off
  });

  describe('force — reflection-imposed backoff (ADR-0053)', () => {
    it('rests the source for exactly the given ticks, then retries', () => {
      const b = new AdaptiveBackoff(opts);
      b.force('gdelt', 5, 3);
      expect(b.activeBackoffs(5).has('gdelt')).toBe(true);
      expect(b.activeBackoffs(7).has('gdelt')).toBe(true);
      expect(b.activeBackoffs(8).has('gdelt')).toBe(false); // cooldown over
    });
  });

  describe('seed — rehydrate streaks from persisted tick history (ADR-0053)', () => {
    it('replays persisted tick outcomes so a deploy does not reset streaks', () => {
      const b = new AdaptiveBackoff(opts);
      // Three persisted ticks (oldest first), gdelt failing in each.
      const next = b.seed(
        [
          { skipped: ['gdelt'], failed: [] },
          { skipped: [], failed: [{ source: 'gdelt' }] },
          { skipped: ['gdelt'], failed: [] },
        ],
        ['gdelt', 'arxiv'],
      );
      expect(next).toBe(3); // the loop resumes at the next tick index
      expect(b.activeBackoffs(next).has('gdelt')).toBe(true); // still cooling down
      expect(b.activeBackoffs(next).has('arxiv')).toBe(false); // arxiv succeeded throughout
    });

    it('a success inside the history resets the streak, as live observation would', () => {
      const b = new AdaptiveBackoff(opts);
      const next = b.seed(
        [
          { skipped: ['gdelt'], failed: [] },
          { skipped: [], failed: [] }, // recovered
          { skipped: ['gdelt'], failed: [] },
        ],
        ['gdelt'],
      );
      expect(b.activeBackoffs(next).has('gdelt')).toBe(false); // streak is 1, not 3
    });

    it('seeding an empty history is a no-op starting at tick 0', () => {
      const b = new AdaptiveBackoff(opts);
      expect(b.seed([], ['gdelt'])).toBe(0);
      expect(b.activeBackoffs(0).size).toBe(0);
    });
  });
});
