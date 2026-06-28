import { describe, expect, it } from 'vitest';
import { candidatePairs, cluster } from '../../src/pipeline/cluster.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import type { EmbeddedItem } from '../../src/pipeline/types.js';
import type { RawItem } from '../../src/domain/types.js';

const opts = { candidateThreshold: 0.78 };

function embedded(externalId: string, vector: number[]): EmbeddedItem {
  const item: RawItem = {
    source: 'hackernews',
    externalId,
    title: `story ${externalId}`,
    url: null,
    text: null,
    publishedAt: null,
    metadata: {},
  };
  return { item, topic: 'AI', vector };
}

describe('candidatePairs (embedding blocking)', () => {
  it('returns only index pairs whose cosine clears the threshold', () => {
    const items = [
      embedded('1', [1, 0, 0]),
      embedded('2', [0.99, 0.02, 0]), // near 1
      embedded('3', [0, 1, 0]), // orthogonal to both
    ];
    expect(candidatePairs(items, 0.78)).toEqual([[0, 1]]);
  });
});

describe('cluster stage', () => {
  it('merges near-neighbor items the LLM confirms as the same story', async () => {
    const llm = new FakeLLM({ confirm: true });
    const clusters = await cluster(
      [embedded('1', [1, 0, 0]), embedded('2', [0.99, 0.02, 0])],
      llm,
      opts,
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.items).toHaveLength(2);
    expect(clusters[0]?.topic).toBe('AI');
  });

  it('keeps dissimilar items apart and never asks the LLM to confirm', async () => {
    const llm = new FakeLLM({ confirm: true });
    const clusters = await cluster(
      [embedded('1', [1, 0, 0]), embedded('2', [0, 1, 0])],
      llm,
      opts,
    );

    expect(clusters).toHaveLength(2);
    expect(llm.confirmCalls).toBe(0); // below threshold → no candidate pair
  });

  it('splits near-neighbor items the LLM rejects (false positive guard)', async () => {
    const llm = new FakeLLM({ confirm: false });
    const clusters = await cluster(
      [embedded('1', [1, 0, 0]), embedded('2', [0.99, 0.02, 0])],
      llm,
      opts,
    );

    expect(clusters).toHaveLength(2);
    expect(llm.confirmCalls).toBe(1); // candidate found, LLM said no
  });
});
