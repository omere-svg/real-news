import { describe, expect, it } from 'vitest';
import { assembleSignals, score } from '../../src/pipeline/score.js';
import { computeBaseScore } from '../../src/scoring/compute-base-score.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { FakeClock } from '../helpers/fake-clock.js';
import type { Cluster, RawItem, SourceId } from '../../src/domain/types.js';

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

function member(
  source: SourceId,
  externalId: string,
  metadata: RawItem['metadata'],
  publishedAt: number | null = null,
): RawItem {
  return {
    source,
    externalId,
    title: `${source} ${externalId}`,
    url: null,
    text: null,
    publishedAt,
    metadata,
  };
}

function cluster(items: RawItem[]): Cluster {
  return { items, region: 'World', topic: 'AI' };
}

const ctx = {
  clock: new FakeClock(NOW),
  recencyHalfLifeHours: 24,
  maxEditorialAdjustment: 1.5,
  sourceWeights: { hackernews: 0.6, gdelt: 0.7 } as Partial<
    Record<SourceId, number>
  >,
};

describe('assembleSignals', () => {
  it('derives corroboration, peak points, and age from cluster members', () => {
    const c = cluster([
      member('hackernews', '1', { points: 100 }, NOW - 2 * HOUR),
      member('gdelt', '2', { points: 250 }, NOW - 10 * HOUR),
    ]);

    const signals = assembleSignals(c, NOW, ctx.sourceWeights);

    expect(signals.corroboration).toBe(2); // two distinct sources
    expect(signals.points).toBe(250); // peak across members
    expect(signals.ageHours).toBeCloseTo(2, 5); // freshest member
    expect(signals.sourceWeight).toBeCloseTo(0.7, 5); // strongest source
  });
});

describe('score stage', () => {
  it('returns the base score unchanged when the LLM adjustment is zero', async () => {
    const c = cluster([member('hackernews', '1', { points: 80 }, NOW)]);
    const llm = new FakeLLM({ adjust: 0 });

    const [scored] = await score([c], llm, ctx);

    const base = computeBaseScore(assembleSignals(c, NOW, ctx.sourceWeights), {
      recencyHalfLifeHours: 24,
    });
    expect(scored?.significance).toBeCloseTo(base, 5);
  });

  it('clamps the editorial adjustment to ±maxEditorialAdjustment', async () => {
    const c = cluster([member('hackernews', '1', { points: 80 }, NOW)]);
    const base = computeBaseScore(assembleSignals(c, NOW, ctx.sourceWeights), {
      recencyHalfLifeHours: 24,
    });

    const boosted = await score([c], new FakeLLM({ adjust: 99 }), ctx);
    expect(boosted[0]?.significance).toBeCloseTo(
      Math.min(10, base + 1.5),
      5,
    );

    const slammed = await score([c], new FakeLLM({ adjust: -99 }), ctx);
    expect(slammed[0]?.significance).toBeCloseTo(Math.max(0, base - 1.5), 5);
  });
});
