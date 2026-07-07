import type { Topic } from '../domain/types.js';
import type { Depth } from './budget.js';

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

  /**
   * The SAME budgeted selection as `textBrief`, but structured — so the web
   * viewer can render scannable cards with an inspectable "Why this score?"
   * breakdown (ADR-0064) instead of re-parsing the text. The bot keeps using the
   * text brief; this is the web's richer read of one shared selection, not a new
   * ranking path.
   */
  briefStories(request: BriefRequest): Promise<readonly BriefStory[]>;

  /** A unified audio podcast script within a time budget. */
  podcastScript(request: BriefRequest): Promise<string>;
}

/** One scored scoring axis, labeled and normalized to [0,1] (ADR-0034/0064). */
export interface BriefScoreDriver {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/**
 * A budgeted Story rendered for the web, with its inspectable score breakdown
 * (ADR-0064). `summary`/`whyItMatters` are already depth-trimmed to match the
 * text brief exactly, so the two surfaces never diverge.
 */
export interface BriefStory {
  /** Display headline — the deep-tier English title when set, else the raw title. */
  readonly title: string;
  readonly topic: Topic;
  readonly significance: number;
  readonly url: string | null;
  /** Depth-trimmed factual recap (null at headline depth or when unavailable). */
  readonly summary: string | null;
  /** The "why it matters" line, present only at full depth. */
  readonly whyItMatters: string | null;
  readonly depth: Depth;
  /** Compact human rationale tags (the same ones on the text brief). */
  readonly tags: readonly string[];
  /**
   * The scoring axes strongest-first (impact / corroboration / authority /
   * attention), each normalized to [0,1] — the "exact math" the UI expands.
   * Empty for Stories scored before the breakdown existed.
   */
  readonly drivers: readonly BriefScoreDriver[];
  /** Recency factor in [0,1] applied to the score. */
  readonly recencyFactor: number;
  /** Distinct corroborating sources. */
  readonly corroboration: number;
  /** Bounded numeric-Signal nudge (signed). */
  readonly signalNudge: number;
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
