import type { Topic } from '../domain/types.js';

/**
 * The Presentation seam (ADR-0011). Generates user-facing artifacts from the
 * pre-compiled Story cache — never makes real-time external calls (Principle 4).
 * Implemented by `HorizonQuery` (ADR-0014). The two reader-facing artifacts are
 * the text brief and the narrated podcast (ADR-0060); each is sized to a time
 * budget and drawn from the same significance-ranked, topic-filterable pool.
 */
export interface QueryEngine {
  /** A concise text bullet brief within a time budget. */
  textBrief(request: BriefRequest): Promise<string>;

  /** A unified audio podcast script within a time budget. */
  podcastScript(request: BriefRequest): Promise<string>;
}

export interface BriefRequest {
  /** User's attention budget, mapped to information density (Principle 5). */
  readonly minutes: number;
  readonly topics?: readonly Topic[];
  /** Soft per-topic ranking weights from feedback (ADR-0026); absent ≡ neutral. */
  readonly topicWeights?: Partial<Record<Topic, number>>;
  /** The user's free-text personal context, injected into LLM paths (ADR-0028). */
  readonly memory?: string;
}
