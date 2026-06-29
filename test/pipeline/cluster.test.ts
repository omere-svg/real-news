import { describe, expect, it } from 'vitest';
import { candidatePairs, cluster } from '../../src/pipeline/cluster.js';
import { FakeLLM } from '../helpers/fake-llm.js';
import type { EmbeddedItem } from '../../src/pipeline/types.js';
import type { RawItem } from '../../src/domain/types.js';

const opts = { candidateThreshold: 0.78 };

function embedded(externalId: string, vector: number[], title?: string): EmbeddedItem {
  const item: RawItem = {
    source: 'hackernews',
    externalId,
    title: title ?? `story ${externalId}`,
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

  it('entity blocking relaxes the bar for pairs sharing a named entity (ADR-0036)', () => {
    // cosine ≈ 0.70 — below base 0.78, above relaxed 0.65.
    const a = embedded('1', [1, 0, 0], 'Venezuela earthquake death toll rises to 1,400');
    const b = embedded('2', [0.7, 0.7141, 0], "Venezuela races to find earthquake survivors");
    const entity = { relaxedThreshold: 0.65, minSharedEntities: 1 };

    expect(candidatePairs([a, b], 0.78)).toEqual([]); // off → pure cosine, no pair
    expect(candidatePairs([a, b], 0.78, entity)).toEqual([[0, 1]]); // shared "Venezuela" → relaxed
  });

  it('entity blocking does NOT pair entity-sharing items that lack real similarity', () => {
    const a = embedded('1', [1, 0, 0], 'Venezuela earthquake kills hundreds');
    const b = embedded('2', [0, 1, 0], 'Venezuela signs new trade deal'); // orthogonal
    const entity = { relaxedThreshold: 0.65, minSharedEntities: 1 };
    expect(candidatePairs([a, b], 0.78, entity)).toEqual([]); // cosine 0 < relaxed bar
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
