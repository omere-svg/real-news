import type { DegradeAwareEmbedder, EmbedBatch, Embedder } from './embedder.js';
import type { SpendBudget } from '../llm/spend-guard.js';

/**
 * Wraps a primary Embedder so an embeddings failure degrades the tick instead of
 * crashing it (ADR-0018, same hygiene as ADR-0001 / ResilientLLMClient): on
 * error it falls back to a secondary Embedder (e.g. the dependency-free
 * HashingEmbedder) and logs. Both should share dimensionality so vector lengths
 * stay consistent across a fallback.
 *
 * It also reports, per batch, whether it degraded (ADR-0065) via `embedBatch`.
 * Fallback vectors (e.g. hashing) live in a different space than the persisted
 * neural vectors; they're fine for in-tick blocking but must not be written to
 * the durable index, or they'd silently poison cross-tick merge and search.
 *
 * Embeddings tokens count toward the daily spend ceiling too (ADR-0062), so an
 * optional `budget` lets the embedder short-circuit to the fallback — without
 * touching the paid API — once the cap is exhausted. Otherwise the pipeline's
 * LLM calls would degrade at the cap while embeddings kept billing every tick,
 * letting estimated spend climb past the backstop (Bugbot finding).
 */
export class ResilientEmbedder implements DegradeAwareEmbedder {
  readonly dimensions: number;

  constructor(
    private readonly primary: Embedder,
    private readonly fallback: Embedder,
    // Composition root wires the real Logger-backed callback (main.ts); this
    // default only covers callers (tests) that don't care about the degrade log.
    private readonly onError: (op: string, err: unknown) => void = () => undefined,
    // Optional daily spend backstop; when exhausted, skip the paid primary.
    private readonly budget?: SpendBudget,
  ) {
    this.dimensions = primary.dimensions;
  }

  /** Vectors only — the plain Embedder contract, for callers that don't persist. */
  async embed(texts: readonly string[]): Promise<number[][]> {
    return (await this.embedBatch(texts)).vectors;
  }

  /** Vectors plus a per-batch `degraded` flag (true when the fallback was used). */
  async embedBatch(texts: readonly string[]): Promise<EmbedBatch> {
    if (this.budget?.isExhausted()) {
      this.onError('embed.budget_exhausted', new Error('daily spend cap reached'));
      return { vectors: await this.fallback.embed(texts), degraded: true };
    }
    try {
      return { vectors: await this.primary.embed(texts), degraded: false };
    } catch (err) {
      this.onError('embed', err);
      return { vectors: await this.fallback.embed(texts), degraded: true };
    }
  }
}
