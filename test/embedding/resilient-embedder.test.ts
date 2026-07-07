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

  it('embedBatch flags a degraded batch so callers can decline to persist it (ADR-0065)', async () => {
    const ok = new ResilientEmbedder(new FakeEmbedder({ hello: [1, 0, 0] }), new FakeEmbedder({ hello: [0, 9, 0] }));
    expect(await ok.embedBatch(['hello'])).toEqual({ vectors: [[1, 0, 0]], degraded: false });

    const fell = new ResilientEmbedder(broken, new FakeEmbedder({ hello: [0, 1, 0] }));
    expect(await fell.embedBatch(['hello'])).toEqual({ vectors: [[0, 1, 0]], degraded: true });
  });

  it('skips the paid primary entirely once the daily spend budget is exhausted '
    + '(ADR-0062, Bugbot finding) — degraded so callers do not persist it', async () => {
    const primary = { dimensions: 3, embed: vi.fn(async () => [[1, 0, 0]]) };
    const fallback = new FakeEmbedder({ hello: [0, 1, 0] });
    const onError = vi.fn();

    // Budget exhausted: the primary must never be called.
    const capped = new ResilientEmbedder(primary, fallback, onError, { isExhausted: () => true });
    expect(await capped.embedBatch(['hello'])).toEqual({ vectors: [[0, 1, 0]], degraded: true });
    expect(primary.embed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();

    // Budget healthy: the primary runs as normal.
    const open = new ResilientEmbedder(primary, fallback, onError, { isExhausted: () => false });
    expect(await open.embedBatch(['hello'])).toEqual({ vectors: [[1, 0, 0]], degraded: false });
    expect(primary.embed).toHaveBeenCalledOnce();
  });
});
