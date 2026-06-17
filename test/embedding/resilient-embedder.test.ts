import { describe, expect, it, vi } from 'vitest';
import { ResilientEmbedder } from '../../src/embedding/resilient-embedder.js';
import { FakeEmbedder } from '../helpers/fake-embedder.js';
import type { Embedder } from '../../src/embedding/embedder.js';

const broken: Embedder = {
  dimensions: 3,
  embed: async () => {
    throw new Error('embeddings api down');
  },
};

describe('ResilientEmbedder', () => {
  it('passes primary results through when it succeeds', async () => {
    const primary = new FakeEmbedder({ hello: [1, 0, 0] });
    const fallback = new FakeEmbedder({ hello: [0, 0, 9] });
    const e = new ResilientEmbedder(primary, fallback);

    expect(await e.embed(['hello'])).toEqual([[1, 0, 0]]);
  });

  it('falls back to the secondary embedder when the primary throws', async () => {
    const fallback = new FakeEmbedder({ hello: [0, 1, 0] });
    const onError = vi.fn();
    const e = new ResilientEmbedder(broken, fallback, onError);

    expect(await e.embed(['hello'])).toEqual([[0, 1, 0]]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('reports the primary dimensionality', () => {
    const e = new ResilientEmbedder(new FakeEmbedder({}, 1536), new FakeEmbedder({}, 1536));
    expect(e.dimensions).toBe(1536);
  });
});
