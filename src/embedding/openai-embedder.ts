import OpenAI from 'openai';
import type { Embedder } from './embedder.js';
import { withRetry } from '../llm/retry.js';

export interface OpenAIEmbedderDeps {
  /** Embeddings model, e.g. `text-embedding-3-small` (ADR-0018). */
  readonly model: string;
  /** Output dimensionality (the API's `dimensions` param for -3 models). */
  readonly dimensions: number;
  /** Injectable for testing; defaults to a real client reading OPENAI_API_KEY. */
  readonly client?: OpenAI;
}

/**
 * Neural Embedder backed by the OpenAI embeddings API (ADR-0018). Embeds a batch
 * of titles in one call for the dedup blocking step (ADR-0007) and cross-tick
 * matching (ADR-0017). Wrap in `ResilientEmbedder` so a transient API error
 * degrades the tick to hashing quality instead of failing it.
 */
export class OpenAIEmbedder implements Embedder {
  readonly dimensions: number;
  private readonly client: OpenAI;

  constructor(private readonly deps: OpenAIEmbedderDeps) {
    this.dimensions = deps.dimensions;
    // Placeholder key so a missing key degrades at call time (via the resilient
    // embedder) instead of throwing at construction.
    // maxRetries: 0 — retry lives in withRetry (ADR-0049), not stacked on the SDK's.
    this.client =
      deps.client ??
      new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'missing', maxRetries: 0 });
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // Retry transient blips before the resilient embedder falls back to hashing —
    // a hash vector mixed into a store of neural vectors breaks cosine dedup for
    // every later comparison, so avoiding an avoidable fallback matters (ADR-0047).
    const res = await withRetry(() =>
      this.client.embeddings.create({
        model: this.deps.model,
        dimensions: this.deps.dimensions,
        input: texts as string[],
      }),
    );
    // The API returns one entry per input carrying its `index`; order by it so
    // each vector lines up with its text regardless of response ordering.
    return [...res.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
