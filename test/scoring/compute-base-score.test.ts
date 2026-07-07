import { describe, expect, it } from 'vitest';
import {
  baseScoreBreakdown,
  computeBaseScore,
} from '../../src/scoring/compute-base-score.js';
import type { Signals } from '../../src/domain/types.js';

/** A neutral baseline of Signals; tests override only the fields they exercise. */
function signals(overrides: Partial<Signals> = {}): Signals {
  return {
    points: 0,
    mentions: 0,
    tone: 0,
    sourceWeight: 0.5,
    ageHours: 0,
    corroboration: 1,
    ...overrides,
  };
}

const params = { recencyHalfLifeHours: 36 };

describe('impact-first base score (ADR-0034)', () => {
  it('clamps within [0, 10] for absurd inputs', () => {
    const huge = computeBaseScore(
      signals({ points: 1e6, mentions: 1e6, sourceWeight: 1, corroboration: 1000 }),
      params,
    );
    expect(huge).toBeLessThanOrEqual(10);
    expect(huge).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — same inputs yield the same score', () => {
    const s = signals({ points: 120, corroboration: 2 });
    expect(baseScoreBreakdown(s, 0.5, params).base).toBe(baseScoreBreakdown(s, 0.5, params).base);
  });

  it('rises sharply with real-world impact', () => {
    const lo = baseScoreBreakdown(signals(), 0.1, params).base;
    const hi = baseScoreBreakdown(signals(), 0.9, params).base;
    expect(hi).toBeGreaterThan(lo + 3); // impact dominates the scale
  });

  it('rises with corroboration — more independent sources, higher score', () => {
    const lone = baseScoreBreakdown(signals({ corroboration: 1 }), 0, params).base;
    const many = baseScoreBreakdown(signals({ corroboration: 5 }), 0, params).base;
    expect(many).toBeGreaterThan(lone);
  });

  it('rises with source authority', () => {
    const low = baseScoreBreakdown(signals({ sourceWeight: 0.2 }), 0, params).base;
    const high = baseScoreBreakdown(signals({ sourceWeight: 1 }), 0, params).base;
    expect(high).toBeGreaterThan(low);
  });

  it('treats social attention as a booster that never penalizes its absence', () => {
    // A high-authority, high-impact story with NO social signal still scores high.
    const quiet = baseScoreBreakdown(signals({ points: 0, sourceWeight: 0.7 }), 0.9, params).base;
    expect(quiet).toBeGreaterThan(7);
    // Adding popularity only lifts it further, never lowers it.
    const loud = baseScoreBreakdown(signals({ points: 500, sourceWeight: 0.7 }), 0.9, params).base;
    expect(loud).toBeGreaterThanOrEqual(quiet);
  });

  it('the earthquake beats the viral benchmark post (the ADR-0034 scenario)', () => {
    // High-impact disaster from an official source, two days old, no upvotes.
    const earthquake = baseScoreBreakdown(
      signals({ sourceWeight: 0.5, points: 0, ageHours: 48, corroboration: 1 }),
      0.95,
      params,
    ).base;
    // Viral tech post: lots of HN points, Tier-C authority, negligible real impact.
    const benchmark = baseScoreBreakdown(
      signals({ sourceWeight: 0.35, points: 600, mentions: 300, ageHours: 2 }),
      0.1,
      params,
    ).base;
    expect(earthquake).toBeGreaterThan(benchmark);
  });

  it('uses the upper range for a major, corroborated, authoritative event', () => {
    const major = baseScoreBreakdown(
      signals({ sourceWeight: 0.75, corroboration: 5, ageHours: 0 }),
      0.95,
      params,
    ).base;
    expect(major).toBeGreaterThan(9);
  });

  it('authority alone cannot lift a low-impact item into the top bands (calibration)', () => {
    // Live finding: fresh NBER working papers (sourceWeight 0.7, lone source, no
    // attention) outranked mass-casualty storms. Authority must scale with impact.
    const paperish = signals({ sourceWeight: 0.7, corroboration: 1, points: 0, ageHours: 0 });
    // A routine paper (impact ~0.15) stays firmly in the low band.
    expect(baseScoreBreakdown(paperish, 0.15, params).base).toBeLessThan(3.5);
    // Even a generously mid-impact estimate (0.5) cannot reach the 6.5+ band on
    // authority + freshness alone.
    expect(baseScoreBreakdown(paperish, 0.5, params).base).toBeLessThan(6.5);
    // But a genuinely high-impact item from the same source still scores high —
    // the scaling must not blunt real events.
    expect(baseScoreBreakdown(paperish, 0.9, params).base).toBeGreaterThan(7);
  });

  it('recency de-emphasizes but never erases — floored at half', () => {
    const fresh = baseScoreBreakdown(signals(), 0.9, params);
    const ancient = baseScoreBreakdown(signals({ ageHours: 100_000 }), 0.9, params);
    expect(fresh.recencyFactor).toBeCloseTo(1, 10);
    expect(ancient.recencyFactor).toBeCloseTo(0.5, 5); // floor, not zero
    expect(ancient.base).toBeGreaterThan(fresh.base * 0.49);
  });

  it('reports one component per axis, each a normalized [0,1] value', () => {
    const bd = baseScoreBreakdown(signals({ points: 100, corroboration: 3 }), 0.6, params);
    expect(bd.components.map((c) => c.key).sort()).toEqual([
      'attention', 'authority', 'corroboration', 'impact',
    ]);
    for (const c of bd.components) {
      expect(c.value).toBeGreaterThanOrEqual(0);
      expect(c.value).toBeLessThanOrEqual(1);
    }
    expect(bd.components.find((c) => c.key === 'impact')?.value).toBeCloseTo(0.6, 10);
  });

  it('computeBaseScore is the impact-0 base', () => {
    const s = signals({ points: 80, corroboration: 2 });
    expect(computeBaseScore(s, params)).toBeCloseTo(baseScoreBreakdown(s, 0, params).base, 10);
  });
});
