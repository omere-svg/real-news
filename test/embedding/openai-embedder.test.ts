import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAIEmbedder } from '../../src/embedding/openai-embedder.js';

/** A stub OpenAI client whose embeddings.create returns canned vectors. */
function stubClient(create: ReturnType<typeof vi.fn>): OpenAI {
  return { embeddings: { create } } as unknown as OpenAI;
}

describe('OpenAIEmbedder', () => {
  it('returns the embeddings in input order', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] }, // out of order on purpose
      ],
    });
    const embedder = new OpenAIEmbedder({
      model: 'text-embedding-3-small',
      dimensions: 2,
      client: stubClient(create),
    });

    const out = await embedder.embed(['first', 'second']);

    expect(out).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      dimensions: 2,
      input: ['first', 'second'],
    });
  });

  it('short-circuits an empty batch without calling the API', async () => {
    const create = vi.fn();
    const embedder = new OpenAIEmbedder({
      model: 'm',
      dimensions: 2,
      client: stubClient(create),
    });

    expect(await embedder.embed([])).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('exposes its configured dimensionality', () => {
    const embedder = new OpenAIEmbedder({
      model: 'm',
      dimensions: 1536,
      client: stubClient(vi.fn()),
    });
    expect(embedder.dimensions).toBe(1536);
  });

  it('reports token usage to the ledger via onUsage', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [{ index: 0, embedding: [1, 0] }],
      usage: { prompt_tokens: 12, total_tokens: 12 },
    });
    const onUsage = vi.fn();
    const embedder = new OpenAIEmbedder({
      model: 'text-embedding-3-small',
      dimensions: 2,
      client: stubClient(create),
      onUsage,
    });

    await embedder.embed(['hello world']);

    expect(onUsage).toHaveBeenCalledWith({ totalTokens: 12 });
  });

  it('does not report usage for an empty batch (no API call made)', async () => {
    const onUsage = vi.fn();
    const embedder = new OpenAIEmbedder({
      model: 'm',
      dimensions: 2,
      client: stubClient(vi.fn()),
      onUsage,
    });

    await embedder.embed([]);

    expect(onUsage).not.toHaveBeenCalled();
  });

  it('tolerates a missing usage field on the response (never throws)', async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ index: 0, embedding: [1, 0] }] });
    const onUsage = vi.fn();
    const embedder = new OpenAIEmbedder({
      model: 'm',
      dimensions: 2,
      client: stubClient(create),
      onUsage,
    });

    await expect(embedder.embed(['x'])).resolves.toEqual([[1, 0]]);
    expect(onUsage).not.toHaveBeenCalled();
  });
});
