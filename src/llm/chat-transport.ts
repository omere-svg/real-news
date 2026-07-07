/**
 * The chat transport seam (ADR-0016). The thin, provider-specific half of the
 * Reasoner: send a prompt to a model and return its reply. All editorial
 * reasoning — prompts, schemas, tier choice — lives above this in `Reasoner`;
 * an adapter here only knows how to talk to one provider.
 */
export interface ChatTransport {
  /** Free-form completion → reply text. */
  complete(prompt: string, opts: CompletionOptions): Promise<string>;
  /** Completion constrained to a single JSON object → the parsed value. */
  completeJson(prompt: string, opts: CompletionOptions): Promise<unknown>;
}

export interface CompletionOptions {
  /** Which model tier to use (ADR-0006): cheap high-volume vs. deep analysis. */
  readonly tier: 'cheap' | 'deep';
  /** Upper bound on reply tokens. */
  readonly maxTokens: number;
  /** Sampling temperature; omit for the provider default. Low (≈0.3) locks
   * formatting consistency on the generation prompts (ADR-0050). */
  readonly temperature?: number;
}
