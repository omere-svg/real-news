import type { Topic } from '../domain/types.js';

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
   * Cheap tier: estimate a story's real-world impact in [0, 1] — casualties,
   * disaster scale, major economic/geopolitical stakes (ADR-0034). An inspectable
   * extracted input to the deterministic score, not a final rating.
   */
  assessImpact(input: ImpactInput): Promise<number>;

  /**
   * Expensive tier (Opus): in one call, write both a factual "what happened"
   * summary and the editorial "why it matters" justification. Called only on the
   * top-N most significant Clusters per tick.
   */
  analyze(input: AnalyzeInput): Promise<StoryAnalysis>;

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

  /**
   * Deep tier: answer a user's follow-up question about the news, grounded in
   * the Stories drawn from the cache (and optional web results when the cache
   * came up short). Reports whether the cache alone sufficed so the caller can
   * escalate to a web search (ADR-0029).
   */
  discuss(input: DiscussInput): Promise<DiscussResult>;

  /**
   * Cheap tier: map a free-text message to the single action the user wants
   * (ADR-0030), so plain English and tapped buttons drive the bot instead of
   * slash commands. Pure intent classification — it names the action and pulls
   * out minutes/topic; the dispatcher does the work behind the existing seams.
   */
  routeIntent(input: RouteInput): Promise<RouterIntent>;

  /**
   * Cheap tier: interpret a plain-language request to change the hard
   * preference filters (ADR-0030) — set/add/remove topics, set the default
   * budget. Names the change; the bot validates against the controlled
   * vocabulary and merges it. Distinct from `interpretFeedback` (soft weights).
   */
  interpretPrefs(input: PrefsInput): Promise<PrefsPatch>;
}

/**
 * The narrow seam the Telegram bot depends on for feedback (ADR-0026) — it has
 * no business calling classify/analyze/narrate. Any `LLMClient` satisfies it.
 */
export type FeedbackInterpreter = Pick<LLMClient, 'interpretFeedback'>;

/** The narrow seam the bot depends on for chat (ADR-0029). */
export type Discussant = Pick<LLMClient, 'discuss'>;

/** The narrow seam the bot depends on for natural-language routing (ADR-0030). */
export type IntentRouter = Pick<LLMClient, 'routeIntent'>;

/** The narrow seam the bot depends on for plain-language preference edits (ADR-0030). */
export type PreferencesInterpreter = Pick<LLMClient, 'interpretPrefs'>;

/** The narrow seam the Presentation layer depends on for podcast narration (ADR-0014). */
export type Narrator = Pick<LLMClient, 'narrate'>;

export interface ClassifyInput {
  readonly title: string;
  readonly text: string | null;
}

export interface Classification {
  readonly topic: Topic;
}

export interface StoryStub {
  readonly title: string;
  readonly text: string | null;
}

export interface ImpactInput {
  readonly title: string;
  readonly text: string | null;
}

export interface AnalyzeInput {
  readonly title: string;
  readonly text: string | null;
  readonly topic: Topic;
  readonly significance: number;
}

/** The deep-tier editorial output for a Story: the facts and the so-what. */
export interface StoryAnalysis {
  /** A concise factual recap of what happened (≈2 sentences). */
  readonly summary: string;
  /** The editorial "why it matters" justification (2-3 sentences). */
  readonly whyItMatters: string;
}

export interface NarrateInput {
  /** The user's attention budget the narration must fit (ADR-0013). */
  readonly minutes: number;
  /** The deterministic text brief to render as spoken narration. */
  readonly brief: string;
  /** Target spoken length in words (minutes × speaking rate) so the audio fills the budget. */
  readonly targetWords?: number;
  /** The user's free-text personal context to weave in, if any (ADR-0028). */
  readonly memory?: string;
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
 * Invalid Topics are dropped at the Reasoner's schema boundary.
 */
export interface FeedbackIntent {
  readonly topics: ReadonlyArray<{ topic: Topic; direction: WeightDirection }>;
  readonly length: LengthDirection | null;
  /** A short human-readable confirmation of what was understood, for the reply. */
  readonly summary: string;
}

// --- Chat / discussion about the news (ADR-0029) ---

/** A Story drawn from the cache, flattened to the fields the chat prompt needs. */
export interface StoryContext {
  readonly title: string;
  readonly whyItMatters: string | null;
  readonly topic: Topic;
  readonly significance: number;
  readonly url: string | null;
}

/** A single web search hit, the optional fallback ground truth (ADR-0029). */
export interface WebContext {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/** One prior turn in the conversation, for multi-turn context. */
export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface DiscussInput {
  /** The user's current question. */
  readonly question: string;
  /** Recent prior turns for context (oldest first). */
  readonly history: readonly ConversationTurn[];
  /** Stories from the cache to ground the answer in. */
  readonly stories: readonly StoryContext[];
  /** Web results, present only on the escalated second pass (ADR-0029). */
  readonly web?: readonly WebContext[];
  /** The user's free-text personal context, if any (ADR-0028). */
  readonly memory?: string;
}

export interface DiscussResult {
  /** The natural-language answer to send back to the user. */
  readonly answer: string;
  /**
   * Whether the provided news (cache, or web on the second pass) actually
   * contained the answer. `false` on the first pass signals the caller to
   * escalate to a web search (ADR-0029).
   */
  readonly answeredFromNews: boolean;
}

// --- Natural-language intent routing (ADR-0030) ---

/**
 * The single thing a free-text message asks for. Mirrors the user-facing
 * commands so the router can reuse every existing handler; `question` maps to
 * chat (ADR-0029), `help` is the catch-all for greetings and anything unclear.
 */
export type RouterAction =
  | 'brief'
  | 'outline'
  | 'podcast'
  | 'question'
  | 'prefs'
  | 'setPrefs'
  | 'clearPrefs'
  | 'feedback'
  | 'remember'
  | 'forget'
  | 'help';

export interface RouteInput {
  /** The user's raw message. */
  readonly text: string;
}

/**
 * The structured intent parsed from a free-text message. The router names the
 * action and extracts any explicit time budget / topic; argument validation
 * (valid topics, positive minutes) stays where the vocabulary lives — the bot.
 */
export interface RouterIntent {
  readonly action: RouterAction;
  /** An explicit time budget the message asked for, else null. */
  readonly minutes: number | null;
  /** The topic for an outline, else null (validated downstream). */
  readonly topic: string | null;
}

// --- Plain-language preference edits (ADR-0030) ---

/** How a list-valued preference (topics) should change. */
export type PrefsListMode = 'replace' | 'add' | 'remove';

/** A requested change to one list-valued preference; values validated downstream. */
export interface PrefsListChange {
  readonly mode: PrefsListMode;
  readonly values: readonly string[];
}

/**
 * A structured edit to the hard preference filters parsed from free text. Each
 * field is null when the message didn't touch it. The bot validates the values
 * against the controlled vocabulary and merges them onto the chat's prefs.
 */
export interface PrefsPatch {
  readonly topics: PrefsListChange | null;
  /** A new default time budget, else null. */
  readonly minutes: number | null;
  /** One short sentence confirming what was understood, for the reply. */
  readonly summary: string;
}

export interface PrefsInput {
  /** The user's raw preference-change request. */
  readonly text: string;
}
