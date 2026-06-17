import type { Embedder } from './embedder.js';

/**
 * Wraps a primary Embedder so an embeddings failure degrades the tick instead of
 * crashing it (ADR-0018, same hygiene as ADR-0001 / ResilientLLMClient): on
 * error it falls back to a secondary Embedder (e.g. the dependency-free
 * HashingEmbedder) and logs. Both should share dimensionality so vector lengths
 * stay consistent across a fallback.
 */
export class ResilientEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(
    private readonly primary: Embedder,
    private readonly fallback: Embedder,
    private readonly onError: (op: string, err: unknown) => void = (op, err) =>
      console.warn(`[embedder] ${op} failed, degrading:`, err),
  ) {
    this.dimensions = primary.dimensions;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    try {
      return await this.primary.embed(texts);
    } catch (err) {
      this.onError('embed', err);
      return this.fallback.embed(texts);
    }
  }
}
