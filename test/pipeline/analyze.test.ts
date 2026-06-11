import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/pipeline/analyze.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import type { ScoredCluster } from '../../src/pipeline/types.js';
import type { RawItem } from '../../src/domain/types.js';

function scored(externalId: string, significance: number): ScoredCluster {
  const item: RawItem = {
    source: 'hackernews',
    externalId,
    title: `story ${externalId}`,
    url: null,
    text: null,
    publishedAt: null,
    metadata: {},
  };
  return {
    cluster: { items: [item], region: 'World', topic: 'AI' },
    significance,
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
});
