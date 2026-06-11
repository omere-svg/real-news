import type { Embedder } from '../../src/embedding/embedder.js';

/**
 * A deterministic Embedder for tests. Looks up an explicit vector per text so
 * clustering similarity is fully controlled; unknown texts get a zero vector.
 */
export class FakeEmbedder implements Embedder {
  readonly dimensions: number;
  embedCalls = 0;

  constructor(
    private readonly vectors: Record<string, number[]> = {},
    dimensions = 3,
  ) {
    this.dimensions = dimensions;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    this.embedCalls += 1;
    return texts.map(
      (t) => this.vectors[t] ?? new Array<number>(this.dimensions).fill(0),
    );
  }
}
