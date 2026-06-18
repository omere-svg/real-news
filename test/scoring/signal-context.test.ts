import { describe, expect, it } from 'vitest';
import {
  assembleSignalContext,
  signalAdjustment,
} from '../../src/scoring/signal-context.js';
import type { SignalObservation } from '../../src/domain/types.js';

function obs(o: Partial<SignalObservation> = {}): SignalObservation {
  return {
    source: 'wikipedia-pageviews',
    region: 'World',
    topic: null,
    key: 'k',
    value: 100,
    observedAt: 0,
    ...o,
  };
}

describe('assembleSignalContext + signalAdjustment', () => {
  it('a higher observed value yields a larger adjustment (log-normalized)', () => {
    const small = assembleSignalContext([obs({ value: 1_000 })]);
    const large = assembleSignalContext([obs({ value: 400_000 })]);

    const a = signalAdjustment('World', 'AI', small, 1.0);
    const b = signalAdjustment('World', 'AI', large, 1.0);

    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1.0);
    expect(a).toBeGreaterThan(0);
  });

  it('takes the peak salience across observations sharing a partition', () => {
    const ctx = assembleSignalContext([
      obs({ key: 'a', value: 10_000 }),
      obs({ key: 'b', value: 500_000 }), // the peak
    ]);
    const peakOnly = assembleSignalContext([obs({ key: 'b', value: 500_000 })]);

    expect(signalAdjustment('World', 'AI', ctx, 1.0)).toBeCloseTo(
      signalAdjustment('World', 'AI', peakOnly, 1.0),
      10,
    );
  });

  it('matches the cluster topic exactly, else falls back to the region-wide signal', () => {
    const ctx = assembleSignalContext([
      // Region-wide attention (topic null) — World.
      obs({ source: 'wikipedia-pageviews', region: 'World', topic: null, value: 200_000 }),
      // A stronger Business-specific macro signal — World/Business.
      obs({ source: 'worldbank', region: 'World', topic: 'Business', value: 9 }),
    ]);

    const business = signalAdjustment('World', 'Business', ctx, 1.0); // exact (World,Business)
    const science = signalAdjustment('World', 'Science', ctx, 1.0); // falls back to (World,null)

    expect(business).toBeGreaterThan(0);
    expect(science).toBeGreaterThan(0);
    expect(business).not.toBeCloseTo(science, 5); // different partitions, different salience
  });

  it('is zero when no observation informs the cluster partition', () => {
    const ctx = assembleSignalContext([obs({ region: 'World', topic: null })]);
    expect(signalAdjustment('Israel', 'AI', ctx, 1.0)).toBe(0);
  });

  it('never exceeds the configured maximum adjustment', () => {
    const ctx = assembleSignalContext([obs({ value: 10_000_000 })]);
    expect(signalAdjustment('World', 'AI', ctx, 0.8)).toBeLessThanOrEqual(0.8);
  });

  it('an empty context produces no adjustment (existing scoring unchanged)', () => {
    const ctx = assembleSignalContext([]);
    expect(signalAdjustment('World', 'AI', ctx, 1.5)).toBe(0);
  });
});
