/**
 * The Embedder seam (ADR-0007). Produces vectors for the dedup blocking step.
 * The production adapter runs a local model (transformers.js); tests inject a
 * deterministic FakeEmbedder so the real model never loads in unit tests.
 */
export interface Embedder {
  /** The fixed dimensionality of vectors this embedder produces. */
  readonly dimensions: number;

  /** Embed a batch of texts, preserving order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}
