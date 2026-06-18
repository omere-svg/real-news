import type { Region, Topic } from '../domain/types.js';

/**
 * The Reasoner seam (ADR-0006). All model access — both tiers — lives behind
 * this interface so the pipeline is fully unit-testable with a FakeLLM and
 * never calls the network in tests. The tier (Haiku vs Opus) is an
 * implementation detail of the adapter, selected per method.
 */
export interface LLMClient {
  /**
   * Cheap tier (Haiku): classify a free-form item when metadata-first
   * classification (ADR-0009) came up empty.
   */
  classify(input: ClassifyInput): Promise<Classification>;

  /**
   * Cheap tier (Haiku): confirm whether two candidate items are the same
   * Story. Called only on embedding-blocked candidate pairs (ADR-0007).
   */
  confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean>;

  /**
   * Cheap tier (Haiku): a bounded editorial adjustment to the deterministic
   * base score (ADR-0008). Returns a delta the caller clamps.
   */
  adjustSignificance(input: AdjustInput): Promise<number>;

  /**
   * Expensive tier (Opus): generate the Why-It-Matters justification. Called
   * only on the top-N most significant Clusters per tick.
   */
  analyze(input: AnalyzeInput): Promise<string>;

  /**
   * Expensive tier (Opus): turn a budgeted text brief into spoken-flow podcast
   * narration (ADR-0014). Read-path only artifact that touches the model.
   */
  narrate(input: NarrateInput): Promise<string>;

  /**
   * Cheap tier (Haiku): interpret a user's free-text feedback into a structured
   * preference intent (ADR-0026). Pure NLU — it names directions, never numbers;
   * the deterministic weight math lives in `applyFeedback`.
   */
  interpretFeedback(input: FeedbackInput): Promise<FeedbackIntent>;
}

/**
 * The narrow seam the Telegram bot depends on for feedback (ADR-0026) — it has
 * no business calling classify/analyze/narrate. Any `LLMClient` satisfies it.
 */
export type FeedbackInterpreter = Pick<LLMClient, 'interpretFeedback'>;

export interface ClassifyInput {
  readonly title: string;
  readonly text: string | null;
}

export interface Classification {
  readonly region: Region;
  readonly topic: Topic;
}

export interface StoryStub {
  readonly title: string;
  readonly text: string | null;
}

export interface AdjustInput {
  readonly title: string;
  readonly text: string | null;
  readonly baseScore: number;
}

export interface AnalyzeInput {
  readonly title: string;
  readonly text: string | null;
  readonly region: Region;
  readonly topic: Topic;
  readonly significance: number;
}

export interface NarrateInput {
  /** The user's attention budget the narration must fit (ADR-0013). */
  readonly minutes: number;
  /** The deterministic text brief to render as spoken narration. */
  readonly brief: string;
}

// --- Feedback interpretation (ADR-0026) ---

/** Which way the user wants a partition's weight to move. */
export type WeightDirection = 'more' | 'less' | 'mute' | 'reset';
/** How the user wants brief length to move. */
export type LengthDirection = 'shorter' | 'longer' | 'reset';

export interface FeedbackInput {
  /** The user's raw feedback text. */
  readonly text: string;
}

/**
 * The structured intent parsed from free-text feedback. Directions only — the
 * numeric weight math is applied deterministically by `applyFeedback` (ADR-0026).
 * Invalid Topics/Regions are dropped at the Reasoner's schema boundary.
 */
export interface FeedbackIntent {
  readonly topics: ReadonlyArray<{ topic: Topic; direction: WeightDirection }>;
  readonly regions: ReadonlyArray<{ region: Region; direction: WeightDirection }>;
  readonly length: LengthDirection | null;
  /** A short human-readable confirmation of what was understood, for the reply. */
  readonly summary: string;
}
