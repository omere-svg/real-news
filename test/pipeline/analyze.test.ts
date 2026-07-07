import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/pipeline/analyze.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import { fakeBreakdown } from '../helpers/score-breakdown.js';
import type { ScoredCluster } from '../../src/pipeline/types.js';
import type { RawItem } from '../../src/domain/types.js';

function scored(externalId: string, significance: number, title?: string): ScoredCluster {
  const item: RawItem = {
    source: 'hackernews',
    externalId,
    title: title ?? `story ${externalId}`,
    url: null,
    text: null,
    publishedAt: null,
    metadata: {},
  };
  return {
    cluster: { items: [item], topic: 'AI' },
    significance,
    breakdown: fakeBreakdown(significance),
  };
}

const idOf = (c: ScoredCluster) => c.cluster.items[0]?.externalId;

describe('analyze stage', () => {
  it('writes why-it-matters only for the top-N most significant clusters', async () => {
    const llm = new FakeLLM({ analyze: 'It matters.' });
    const clusters = [scored('low', 2), scored('high', 9), scored('mid', 5)];

    const analyzed = await analyze(clusters, llm, 2);

    const byId = Object.fromEntries(analyzed.map((c) => [idOf(c), c]));
    expect(byId['high']?.whyItMatters).toBe('It matters.');
    expect(byId['mid']?.whyItMatters).toBe('It matters.');
    expect(byId['low']?.whyItMatters).toBeNull();
    expect(llm.analyzeCalls).toBe(2); // only the top 2 escalated to Opus
  });

  it('analyzes all clusters when there are fewer than N', async () => {
    const llm = new FakeLLM({ analyze: 'It matters.' });
    const analyzed = await analyze([scored('a', 3)], llm, 10);

    expect(analyzed[0]?.whyItMatters).toBe('It matters.');
    expect(llm.analyzeCalls).toBe(1);
  });

  it('persists an English displayTitle from the deep call for top-N clusters only (Task 20)', async () => {
    const llm = new FakeLLM({
      analyze: { summary: 'S', whyItMatters: 'W', displayTitle: 'Clear English headline' },
    });
    const clusters = [scored('low', 2), scored('high', 9)];

    const analyzed = await analyze(clusters, llm, 1);

    const byId = Object.fromEntries(analyzed.map((c) => [idOf(c), c]));
    expect(byId['high']?.displayTitle).toBe('Clear English headline');
    expect(byId['low']?.displayTitle).toBeNull(); // below top-N & English: no deep call, no displayTitle
  });

  it('translates a below-top-N NON-English headline to English (ADR-0057)', async () => {
    const llm = new FakeLLM({
      analyze: 'It matters.',
      translate: { displayTitle: 'Lithuania bans false pre-election programs', summary: 'A law was passed.' },
    });
    const clusters = [
      scored('foreign', 3, 'В Литве запретили предвыборные программы'),
      scored('english', 9, 'A clearly English headline'),
    ];

    const analyzed = await analyze(clusters, llm, 1); // only 'english' is top-N

    const byId = Object.fromEntries(analyzed.map((c) => [idOf(c), c]));
    expect(byId['foreign']?.displayTitle).toBe('Lithuania bans false pre-election programs');
    expect(byId['foreign']?.summary).toBe('A law was passed.');
    expect(llm.analyzeCalls).toBe(1); // deep call only for the top-N
    expect(llm.translateCalls).toBe(1); // cheap call only for the foreign, below-top-N title
  });

  it('does not spend a translate call on a below-top-N English headline', async () => {
    const llm = new FakeLLM({ analyze: 'It matters.' });
    const clusters = [scored('low', 2, 'Plain English headline'), scored('high', 9)];

    const analyzed = await analyze(clusters, llm, 1);

    const byId = Object.fromEntries(analyzed.map((c) => [idOf(c), c]));
    expect(byId['low']?.displayTitle).toBeNull();
    expect(llm.translateCalls).toBe(0);
  });
});
