import { describe, expect, it } from 'vitest';
import { parseConfig, sourceWeightsOf } from '../../src/config/load.js';

const valid = {
  tickIntervalMinutes: 15,
  sources: [
    { id: 'hackernews', enabled: true, weight: 0.6, maxItems: 50 },
    { id: 'gdelt', enabled: false, weight: 0.7, maxItems: 50 },
  ],
  reasoner: {},
  dedup: {},
  scoring: {},
  presentation: {},
};

describe('parseConfig', () => {
  it('validates and applies defaults', () => {
    const config = parseConfig(valid);
    expect(config.tickIntervalMinutes).toBe(15);
    expect(config.reasoner.deepAnalysisTopN).toBe(10); // schema default
    expect(config.dedup.candidateThreshold).toBeCloseTo(0.78, 5);
  });

  it('throws on invalid config (missing interval)', () => {
    const { tickIntervalMinutes, ...broken } = valid;
    void tickIntervalMinutes;
    expect(() => parseConfig(broken)).toThrow();
  });
});

describe('sourceWeightsOf', () => {
  it('maps each source id to its weight', () => {
    const weights = sourceWeightsOf(parseConfig(valid));
    expect(weights.hackernews).toBeCloseTo(0.6, 5);
    expect(weights.gdelt).toBeCloseTo(0.7, 5);
  });
});
