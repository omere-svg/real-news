/**
 * The Embedder seam (ADR-0007). Produces vectors for the dedup blocking step.
 * The wired production adapter calls the OpenAI embeddings API (`OpenAIEmbedder`,
 * ADR-0018/0035) with a dependency-free hashing fallback; tests inject a
 * deterministic FakeEmbedder so no network model is reached in unit tests.
 */
export interface Embedder {
  /** The fixed dimensionality of vectors this embedder produces. */
  readonly dimensions: number;

  /** Embed a batch of texts, preserving order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

/** The vectors for one batch plus whether they came from a degraded path. */
export interface EmbedBatch {
  readonly vectors: number[][];
  /**
   * True when these vectors were produced by a fallback (non-semantic) embedder
   * rather than the primary model. Degraded vectors are internally consistent —
   * fine for in-tick blocking — but live in a different space than the persisted
   * neural vectors, so callers must NOT write them to the durable index (ADR-0065).
   */
  readonly degraded: boolean;
}

/**
 * An Embedder that also reports, per batch, whether it fell back to a degraded
 * embedder. `ResilientEmbedder` implements this so the tick can decline to
 * persist fallback vectors that would poison cross-tick merge / semantic search.
 */
export interface DegradeAwareEmbedder extends Embedder {
  embedBatch(texts: readonly string[]): Promise<EmbedBatch>;
}

/** Narrowing helper: does this embedder report per-batch degradation? */
export function isDegradeAware(e: Embedder): e is DegradeAwareEmbedder {
  return typeof (e as Partial<DegradeAwareEmbedder>).embedBatch === 'function';
}
