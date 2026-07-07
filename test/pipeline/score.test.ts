import { describe, expect, it } from 'vitest';
import { assembleSignals, score } from '../../src/pipeline/score.js';
import { computeBaseScore } from '../../src/scoring/compute-base-score.js';
import {
  assembleSignalContext,
  signalAdjustment,
} from '../../src/scoring/signal-context.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { FakeClock } from '../helpers/fake-clock.js';
import type { IdentifiedCluster } from '../../src/pipeline/resolve.js';
import type { Cluster, RawItem, SourceId, StorySourceId } from '../../src/domain/types.js';

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

function member(
  source: StorySourceId,
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
  return { items, topic: 'AI' };
}

// score() now consumes IdentifiedCluster (id + vector threaded from resolve,
// ADR-0063). The score stage ignores id/vector beyond passing them through, so
// a stub id + empty vector is sufficient here.
function ident(c: Cluster): IdentifiedCluster {
  return { id: `id:${c.items[0]?.externalId ?? 'x'}`, cluster: c, vector: [] };
}

const ctx = {
  clock: new FakeClock(NOW),
  recencyHalfLifeHours: 36,
  sourceWeights: { hackernews: 0.35, gdelt: 0.7 } as Partial<
    Record<SourceId, number>
  >,
};
const baseParams = { recencyHalfLifeHours: 36 };

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
  it('equals the deterministic base when impact and signals are zero', async () => {
    const c = cluster([member('hackernews', '1', { points: 80 }, NOW)]);
    const llm = new FakeLLM({ impact: 0 });

    const [scored] = await score([ident(c)], llm, ctx);

    const base = computeBaseScore(assembleSignals(c, NOW, ctx.sourceWeights), baseParams);
    expect(scored?.significance).toBeCloseTo(base, 5);
  });

  it('a high-impact story scores well above a low-impact one (ADR-0034)', async () => {
    const c = cluster([member('guardian', '1', {}, NOW)]); // no social signal
    const low = await score([ident(c)], new FakeLLM({ impact: 0.1 }), ctx);
    const high = await score([ident(c)], new FakeLLM({ impact: 0.9 }), ctx);
    expect(high[0]!.significance).toBeGreaterThan(low[0]!.significance + 3);
  });

  it('emits a breakdown that reconciles to the significance (ADR-0032/0034)', async () => {
    const c = cluster([
      member('hackernews', '1', { points: 200 }, NOW),
      member('gdelt', '2', {}, NOW),
    ]);
    const [scored] = await score([ident(c)], new FakeLLM({ impact: 0.7 }), ctx);

    const bd = scored!.breakdown;
    expect(bd.impact).toBeCloseTo(0.7, 5);
    expect(bd.components.find((x) => x.key === 'impact')?.value).toBeCloseTo(0.7, 5);
    expect(bd.base + bd.signalNudge).toBeCloseTo(scored!.significance, 5);
    expect(bd.signals.corroboration).toBe(2); // two distinct sources recorded
  });

  it('adds a bounded numeric-Signal nudge for the cluster partition (ADR-0025)', async () => {
    const c = cluster([member('hackernews', '1', { points: 80 }, NOW)]); // World / AI
    const base = computeBaseScore(assembleSignals(c, NOW, ctx.sourceWeights), baseParams);

    // A global attention surge should lift all stories via the (*) bucket.
    const signalContext = assembleSignalContext(
      [
        {
          source: 'wikipedia-pageviews',
          topic: null,
          key: 'en.wikipedia:AI:202605',
          value: 400_000,
          observedAt: NOW,
        },
      ],
      { 'wikipedia-pageviews': 500_000 },
    );
    const maxSignalAdjustment = 1.0;
    const expectedNudge = signalAdjustment('AI', signalContext, maxSignalAdjustment);

    const [scored] = await score([ident(c)], new FakeLLM({ impact: 0 }), {
      ...ctx,
      signalContext,
      maxSignalAdjustment,
    });

    expect(expectedNudge).toBeGreaterThan(0);
    expect(scored?.significance).toBeCloseTo(Math.min(10, base + expectedNudge), 5);
  });

  it('leaves scoring untouched when no Signal context is supplied', async () => {
    const c = cluster([member('hackernews', '1', { points: 80 }, NOW)]);
    const base = computeBaseScore(assembleSignals(c, NOW, ctx.sourceWeights), baseParams);

    const [scored] = await score([ident(c)], new FakeLLM({ impact: 0 }), ctx);
    expect(scored?.significance).toBeCloseTo(base, 5);
  });
});
