import { describe, expect, it } from 'vitest';
import { scoreExplanation, COMPONENT_LABELS } from '../../src/presentation/score-explanation.js';
import type { ScoreBreakdown } from '../../src/domain/types.js';

function breakdown(over: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    base: 7,
    recencyFactor: 1,
    impact: 0.9,
    components: [
      { key: 'impact', value: 0.9 },
      { key: 'corroboration', value: 0.7 },
      { key: 'authority', value: 0.7 },
      { key: 'attention', value: 0.2 },
    ],
    signalNudge: 0,
    signals: {
      points: 0, mentions: 0, tone: 0, sourceWeight: 0.7, ageHours: 0, corroboration: 4,
    },
    ...over,
  };
}

describe('scoreExplanation (ADR-0037)', () => {
  it('names the true drivers as compact tags', () => {
    const { tags } = scoreExplanation(breakdown());
    expect(tags).toContain('major real-world impact');
    expect(tags).toContain('4 sources');
    expect(tags).toContain('official source');
    expect(tags).toContain('fresh');
  });

  it('downgrades wording for medium impact and omits weak axes', () => {
    const { tags } = scoreExplanation(
      breakdown({
        impact: 0.5,
        recencyFactor: 0.6, // not fresh
        components: [
          { key: 'impact', value: 0.5 },
          { key: 'corroboration', value: 0 },
          { key: 'authority', value: 0.4 }, // not official
          { key: 'attention', value: 0.1 }, // not high interest
        ],
        signals: { points: 0, mentions: 0, tone: 0, sourceWeight: 0.4, ageHours: 40, corroboration: 1 },
      }),
    );
    expect(tags).toContain('notable impact');
    expect(tags).not.toContain('major real-world impact');
    expect(tags.some((t) => t.includes('sources'))).toBe(false); // lone source
    expect(tags).not.toContain('official source');
    expect(tags).not.toContain('fresh');
  });

  it('returns drivers labeled and sorted strongest-first', () => {
    const { drivers } = scoreExplanation(breakdown());
    expect(drivers[0]?.key).toBe('impact'); // 0.9 is strongest
    expect(drivers[0]?.label).toBe(COMPONENT_LABELS.impact);
    const values = drivers.map((d) => d.value);
    expect(values).toEqual([...values].sort((a, b) => b - a)); // descending
  });

  it('surfaces recency, corroboration and signal nudge for the web table', () => {
    const e = scoreExplanation(breakdown({ recencyFactor: 0.7, signalNudge: 0.3 }));
    expect(e.recencyFactor).toBe(0.7);
    expect(e.corroboration).toBe(4);
    expect(e.signalNudge).toBe(0.3);
  });
});
