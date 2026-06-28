import { describe, expect, it } from 'vitest';
import {
  assembleSignalContext,
  signalAdjustment,
} from '../../src/scoring/signal-context.js';
import type { SignalObservation, SourceId } from '../../src/domain/types.js';

// Each source declares its own saturation scale (ADR-0025/0031); the scoring
// module no longer hardcodes per-source magic numbers, so every test states the
// scale explicitly — the same way the composition root derives it from sources.
const REFS: Partial<Record<SourceId, number>> = {
  'wikipedia-pageviews': 500_000,
  worldbank: 10,
};

function obs(o: Partial<SignalObservation> = {}): SignalObservation {
  return {
    source: 'wikipedia-pageviews',
    topic: null,
    key: 'k',
    value: 100,
    observedAt: 0,
    ...o,
  };
}

describe('assembleSignalContext + signalAdjustment', () => {
  it('a higher observed value yields a larger adjustment (log-normalized)', () => {
    const small = assembleSignalContext([obs({ value: 1_000 })], REFS);
    const large = assembleSignalContext([obs({ value: 400_000 })], REFS);

    const a = signalAdjustment('AI', small, 1.0);
    const b = signalAdjustment('AI', large, 1.0);

    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1.0);
    expect(a).toBeGreaterThan(0);
  });

  it('normalizes each source against its own declared scale, not a shared default', () => {
    // The same raw value (9) means very different things: it nearly saturates
    // World Bank's 10-point scale but is negligible against pageviews' 500k.
    const ctx = assembleSignalContext(
      [
        obs({ source: 'worldbank', topic: 'Business', value: 9 }),
        obs({ source: 'wikipedia-pageviews', topic: 'AI', value: 9 }),
      ],
      REFS,
    );

    const business = signalAdjustment('Business', ctx, 1.0);
    const ai = signalAdjustment('AI', ctx, 1.0);

    expect(business).toBeGreaterThan(0.8); // 9 against a scale of 10 → near-saturated
    expect(ai).toBeLessThan(0.2); // 9 against a scale of 500k → negligible
  });

  it('an observation whose source declares no scale does not contribute', () => {
    // Defensive: the SignalSource interface forces a saturationReference and the
    // composition root derives the map from the live sources, so this can only
    // arise from a malformed call — it must not silently misnormalize.
    const ctx = assembleSignalContext([obs({ value: 400_000 })], {});
    expect(signalAdjustment('AI', ctx, 1.0)).toBe(0);
  });

  it('takes the peak salience across observations sharing a topic', () => {
    const ctx = assembleSignalContext(
      [
        obs({ key: 'a', value: 10_000 }),
        obs({ key: 'b', value: 500_000 }), // the peak
      ],
      REFS,
    );
    const peakOnly = assembleSignalContext([obs({ key: 'b', value: 500_000 })], REFS);

    expect(signalAdjustment('AI', ctx, 1.0)).toBeCloseTo(
      signalAdjustment('AI', peakOnly, 1.0),
      10,
    );
  });

  it('matches the cluster topic exactly, else falls back to the global signal', () => {
    const ctx = assembleSignalContext(
      [
        // Global attention (topic null) — applies to every topic.
        obs({ source: 'wikipedia-pageviews', topic: null, value: 200_000 }),
        // A stronger Business-specific macro signal.
        obs({ source: 'worldbank', topic: 'Business', value: 9 }),
      ],
      REFS,
    );

    const business = signalAdjustment('Business', ctx, 1.0); // exact Business
    const science = signalAdjustment('Science', ctx, 1.0); // falls back to the global bucket

    expect(business).toBeGreaterThan(0);
    expect(science).toBeGreaterThan(0);
    expect(business).not.toBeCloseTo(science, 5); // different buckets, different salience
  });

  it('is zero when no observation informs the cluster topic (and no global signal)', () => {
    const ctx = assembleSignalContext(
      [obs({ source: 'worldbank', topic: 'Business', value: 9 })],
      REFS,
    );
    expect(signalAdjustment('AI', ctx, 1.0)).toBe(0);
  });

  it('never exceeds the configured maximum adjustment', () => {
    const ctx = assembleSignalContext([obs({ value: 10_000_000 })], REFS);
    expect(signalAdjustment('AI', ctx, 0.8)).toBeLessThanOrEqual(0.8);
  });

  it('an empty context produces no adjustment (existing scoring unchanged)', () => {
    const ctx = assembleSignalContext([], REFS);
    expect(signalAdjustment('AI', ctx, 1.5)).toBe(0);
  });
});
