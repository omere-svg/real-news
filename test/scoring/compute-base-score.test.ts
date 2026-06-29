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

const params = { recencyHalfLifeHours: 24 };

describe('computeBaseScore', () => {
  it('clamps the score within [0.0, 10.0] for absurd inputs', () => {
    const huge = computeBaseScore(
      signals({
        points: 1_000_000,
        mentions: 1_000_000,
        tone: 10,
        sourceWeight: 1,
        corroboration: 1000,
      }),
      params,
    );
    expect(huge).toBeLessThanOrEqual(10.0);
    expect(huge).toBeGreaterThanOrEqual(0.0);

    const empty = computeBaseScore(
      signals({ ageHours: 100_000 }), // ancient, nothing going for it
      params,
    );
    expect(empty).toBeGreaterThanOrEqual(0.0);
    expect(empty).toBeLessThanOrEqual(10.0);
  });

  it('is deterministic — same Signals + params yield the same score', () => {
    const s = signals({ points: 120, mentions: 30, corroboration: 2 });
    expect(computeBaseScore(s, params)).toBe(computeBaseScore(s, params));
  });

  it('rises with corroboration — more independent sources, higher score', () => {
    const base = signals({ points: 50, corroboration: 1 });
    const corroborated = signals({ points: 50, corroboration: 4 });
    expect(computeBaseScore(corroborated, params)).toBeGreaterThan(
      computeBaseScore(base, params),
    );
  });

  it('decays with age — one half-life roughly halves the score', () => {
    const fresh = signals({ points: 200, ageHours: 0 });
    const aged = signals({ points: 200, ageHours: 24 }); // exactly one half-life
    const older = signals({ points: 200, ageHours: 48 });

    const freshScore = computeBaseScore(fresh, params);
    const agedScore = computeBaseScore(aged, params);
    const olderScore = computeBaseScore(older, params);

    expect(agedScore).toBeCloseTo(freshScore / 2, 5);
    expect(olderScore).toBeLessThan(agedScore);
  });

  it('has diminishing returns on popularity — early points matter more', () => {
    const score = (points: number) => computeBaseScore(signals({ points }), params);
    const lowGain = score(100) - score(0);
    const highGain = score(10_100) - score(10_000);
    expect(lowGain).toBeGreaterThan(highGain);
  });

  it('rises with engagement (mentions)', () => {
    const quiet = signals({ points: 50, mentions: 0 });
    const buzzing = signals({ points: 50, mentions: 300 });
    expect(computeBaseScore(buzzing, params)).toBeGreaterThan(
      computeBaseScore(quiet, params),
    );
  });

  it('rises with tone extremity, regardless of direction', () => {
    const neutral = signals({ points: 50, tone: 0 });
    const veryNegative = signals({ points: 50, tone: -8 });
    const veryPositive = signals({ points: 50, tone: 8 });

    const neutralScore = computeBaseScore(neutral, params);
    expect(computeBaseScore(veryNegative, params)).toBeGreaterThan(neutralScore);
    expect(computeBaseScore(veryPositive, params)).toBeGreaterThan(neutralScore);
    // Extremity, not sign: equal-magnitude tones score equally.
    expect(computeBaseScore(veryNegative, params)).toBeCloseTo(
      computeBaseScore(veryPositive, params),
      10,
    );
  });

  it('rises with the weight of the contributing source', () => {
    const lowTrust = signals({ points: 50, sourceWeight: 0.2 });
    const highTrust = signals({ points: 50, sourceWeight: 1.0 });
    expect(computeBaseScore(highTrust, params)).toBeGreaterThan(
      computeBaseScore(lowTrust, params),
    );
  });

  it('gives a lone, quiet item a low but valid (non-negative) score', () => {
    const lonely = signals({ points: 2, mentions: 0, corroboration: 1, tone: 0 });
    const score = computeBaseScore(lonely, params);
    expect(score).toBeGreaterThanOrEqual(0.0);
    expect(score).toBeLessThan(3.0); // clearly low-significance
  });
});

describe('baseScoreBreakdown (ADR-0032)', () => {
  it('contributions sum to the same base computeBaseScore returns', () => {
    const s = signals({ points: 300, mentions: 80, corroboration: 4, tone: 5, ageHours: 6 });
    const bd = baseScoreBreakdown(s, params);
    const summed = bd.contributions.reduce((a, c) => a + c.points, 0);
    expect(summed).toBeCloseTo(bd.base, 10);
    expect(bd.base).toBeCloseTo(computeBaseScore(s, params), 10);
  });

  it('reports one contribution per component, all non-negative', () => {
    const bd = baseScoreBreakdown(signals({ points: 100 }), params);
    expect(bd.contributions.map((c) => c.key).sort()).toEqual(
      ['corroboration', 'engagement', 'popularity', 'sourceWeight', 'toneExtremity'],
    );
    for (const c of bd.contributions) expect(c.points).toBeGreaterThanOrEqual(0);
  });

  it('exposes the recency factor that was applied (halves per half-life)', () => {
    expect(baseScoreBreakdown(signals({ ageHours: 0 }), params).recencyFactor).toBeCloseTo(1, 10);
    expect(baseScoreBreakdown(signals({ ageHours: 24 }), params).recencyFactor).toBeCloseTo(0.5, 10);
  });

  it('attributes a corroborated story’s lift to the corroboration component', () => {
    const lone = baseScoreBreakdown(signals({ points: 50, corroboration: 1 }), params);
    const many = baseScoreBreakdown(signals({ points: 50, corroboration: 5 }), params);
    const lift = (bd: ReturnType<typeof baseScoreBreakdown>) =>
      bd.contributions.find((c) => c.key === 'corroboration')!.points;
    expect(lift(lone)).toBeCloseTo(0, 10); // lone source earns no corroboration
    expect(lift(many)).toBeGreaterThan(0);
  });
});
