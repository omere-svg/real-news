import { describe, expect, it } from 'vitest';
import {
  parseConfig,
  sourceWeightsOf,
  toPresentationDefaults,
  toQueryParams,
  toTickConfig,
} from '../../src/config/load.js';

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

describe('toTickConfig', () => {
  it('flattens the validated config into the pipeline config', () => {
    const tick = toTickConfig(parseConfig(valid));
    expect(tick.candidateThreshold).toBeCloseTo(0.78, 5);
    expect(tick.recencyHalfLifeHours).toBe(24); // schema default
    expect(tick.maxEditorialAdjustment).toBeCloseTo(1.5, 5);
    expect(tick.deepAnalysisTopN).toBe(10); // schema default
    expect(tick.sourceWeights.hackernews).toBeCloseTo(0.6, 5);
  });
});

describe('toQueryParams', () => {
  it('maps presentation budget tunables (with schema defaults)', () => {
    const params = toQueryParams(parseConfig(valid));
    expect(params.textWordsPerMinute).toBe(220);
    expect(params.audioWordsPerMinute).toBe(150);
    expect(params.candidatePool).toBe(200);
    expect(params.wordCost).toEqual({ headline: 18, brief: 45, full: 95 });
  });

  it('honours overrides', () => {
    const params = toQueryParams(
      parseConfig({
        ...valid,
        presentation: { textWordsPerMinute: 300, wordCost: { headline: 5 } },
      }),
    );
    expect(params.textWordsPerMinute).toBe(300);
    expect(params.wordCost.headline).toBe(5);
    expect(params.wordCost.full).toBe(95); // untouched default
  });
});

describe('toPresentationDefaults', () => {
  it('maps default budget and preferences', () => {
    const defaults = toPresentationDefaults(
      parseConfig({
        ...valid,
        presentation: {
          defaultMinutes: 7,
          preferredTopics: ['AI'],
          preferredRegions: ['Israel'],
        },
      }),
    );
    expect(defaults.minutes).toBe(7);
    expect(defaults.topics).toEqual(['AI']);
    expect(defaults.regions).toEqual(['Israel']);
  });

  it('omits empty preference arrays so no filter is applied', () => {
    const defaults = toPresentationDefaults(parseConfig(valid));
    expect(defaults.minutes).toBe(3); // schema default
    expect(defaults.topics).toBeUndefined();
    expect(defaults.regions).toBeUndefined();
  });
});
