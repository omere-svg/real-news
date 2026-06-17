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
}

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
