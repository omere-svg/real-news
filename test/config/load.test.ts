import { describe, expect, it } from 'vitest';
import {
  loadConfig,
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
    expect(tick.recencyHalfLifeHours).toBe(36); // schema default (ADR-0034)
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
    expect(params.minDepth).toBe('full'); // readability floor default (ADR-0024)
    expect(params.minStories).toBe(3);
    expect(params.maxStories).toBe(12);
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
        },
      }),
    );
    expect(defaults.minutes).toBe(7);
    expect(defaults.topics).toEqual(['AI']);
  });

  it('omits empty preference arrays so no filter is applied', () => {
    const defaults = toPresentationDefaults(parseConfig(valid));
    expect(defaults.minutes).toBe(3); // schema default
    expect(defaults.topics).toBeUndefined();
  });
});

describe('multi-tenant boot (config/alt.yaml — second-tenant evidence)', () => {
  it('the shipped alt.yaml validates and boots as an independent tenant', () => {
    // Proves the same binary runs a DISTINCT tenant: a second config file, with
    // its own (keyless) source set, parses and flattens through the same seams
    // the composition root uses at boot — no code path is tenant-specific.
    const alt = loadConfig('config/alt.yaml');
    const main = loadConfig('config/horizon.yaml');

    // A distinct, smaller source set than the primary tenant.
    const altSources = alt.sources.map((s) => s.id).sort();
    expect(altSources).toEqual(['hackernews', 'wikipedia']);
    expect(alt.sources.length).toBeLessThan(main.sources.length);

    // The same downstream flatteners the composition root calls succeed for it.
    const tick = toTickConfig(alt);
    expect(tick.deepAnalysisTopN).toBeGreaterThan(0);
    expect(sourceWeightsOf(alt).hackernews).toBeCloseTo(0.35, 5);
    expect(toQueryParams(alt).candidatePool).toBeGreaterThan(0);

    // The daily spend guard (ADR-0062) defaults apply to a tenant that omits it.
    expect(alt.spend.dailyUsdCap).toBeGreaterThan(0);
    expect(alt.spend.pricePerMillionTokens.cheap).toBeGreaterThanOrEqual(0);
  });
});
