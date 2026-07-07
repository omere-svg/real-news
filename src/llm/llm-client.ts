import type { Topic } from '../domain/types.js';

/**
 * The Reasoner seam (ADR-0006), split into ROLE interfaces so each consumer
 * depends only on the model capabilities it actually uses (ADR-0052) — the tick
 * pipeline can't reach the bot's NLU, and vice versa. All model access lives
 * behind these so callers are fully unit-testable with a FakeLLM and never touch
 * the network in tests. The tier (cheap vs deep) is an adapter detail, per method.
 */

/** The model capabilities the tick PIPELINE uses (classify → confirm → score → analyze). */
export interface PipelineReasoner {
  /** Cheap tier: classify a free-form item when metadata-first classification (ADR-0009) is empty. */
  classify(input: ClassifyInput): Promise<Classification>;
  /** Cheap tier: confirm whether two candidate items are the same Story (ADR-0007). */
  confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean>;
  /** Cheap tier: estimate real-world impact in [0,1] — an inspectable score input, not a rating (ADR-0034). */
  assessImpact(input: ImpactInput): Promise<number>;
  /** Deep tier: write the factual summary + "why it matters" for the top-N Clusters. */
  analyze(input: AnalyzeInput): Promise<StoryAnalysis>;
  /**
   * Cheap tier: translate a non-English source item into an English display
   * headline + short factual summary, so a Story below the deep-analysis top-N
   * still stores English text (ADR-0057). The analyze stage calls this only for
   * headlines that fail the `looksNonEnglish` gate — English titles never pay.
   */
  translateToEnglish(input: TranslateInput): Promise<Translation>;
}

/** The model capabilities the BOT's conversational surface uses (ADR-0026/0029/0030). */
export interface ChatReasoner {
  /** Cheap tier: interpret free-text feedback into a preference intent (ADR-0026). */
  interpretFeedback(input: FeedbackInput): Promise<FeedbackIntent>;
  /** Deep tier: answer a question grounded in cache stories (+ optional web) (ADR-0029). */
  discuss(input: DiscussInput): Promise<DiscussResult>;
  /** Cheap tier: map a free-text message to a single action (ADR-0030). */
  routeIntent(input: RouteInput): Promise<RouterIntent>;
  /** Cheap tier: interpret a plain-language hard-preference edit (ADR-0030). */
  interpretPrefs(input: PrefsInput): Promise<PrefsPatch>;
}

/** Deep tier: turn a budgeted brief into spoken-flow podcast narration (ADR-0014). */
export interface Narrator {
  narrate(input: NarrateInput): Promise<string>;
}

/**
 * Deep tier: read recent tick outcomes as a group, write an operator advisory,
 * and propose bounded corrective actions the loop may apply (ADR-0042/0053).
 */
export interface Reflector {
  reflect(input: ReflectInput): Promise<Reflection>;
}

/** The full Reasoner — the intersection of every role. `Reasoner` implements this;
 * consumers should depend on the narrowest role they need, not this union. */
export interface LLMClient extends PipelineReasoner, ChatReasoner, Narrator, Reflector {}

/** Even-narrower single-capability seams the bot's optional deps use (ADR-0026-0030). */
export type FeedbackInterpreter = Pick<ChatReasoner, 'interpretFeedback'>;
export type Discussant = Pick<ChatReasoner, 'discuss'>;
export type IntentRouter = Pick<ChatReasoner, 'routeIntent'>;
export type PreferencesInterpreter = Pick<ChatReasoner, 'interpretPrefs'>;

// --- Reflection over recent ticks (ADR-0042) ---

/** A flattened tick outcome for the reflection prompt (mirrors a persisted TickRecord). */
export interface TickDigest {
  readonly ranAt: number;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly extracted: number;
  readonly storiesUpserted: number;
  readonly signalsObserved: number;
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly source: string; readonly error: string }[];
  readonly error: string | null;
}

export interface ReflectInput {
  /** The recent ticks to reason over, newest first. */
  readonly ticks: readonly TickDigest[];
}

/**
 * A corrective action the reflection proposes (ADR-0053). The vocabulary is a
 * closed whitelist and every magnitude is re-clamped by the deterministic
 * policy guard before anything is applied — the model proposes, the guard
 * disposes. Unknown types are dropped at the schema boundary.
 */
export type ReflectionAction =
  | {
      /** Rest a repeatedly-failing source for a bounded number of ticks. */
      readonly type: 'backoff_source';
      readonly source: string;
      readonly ticks: number;
      readonly reason: string;
    }
  | {
      /** Re-aim the deep-analysis budget (clamped to the guard's bounds). */
      readonly type: 'set_deep_analysis_top_n';
      readonly value: number;
      readonly reason: string;
    }
  | {
      /** Drop the budget override so the configured default governs again. */
      readonly type: 'clear_deep_analysis_top_n';
      readonly reason: string;
    };

/** What a reflection returns: the human-readable advisory + proposed actions. */
export interface Reflection {
  readonly advisory: string;
  readonly actions: readonly ReflectionAction[];
}

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

/**
 * The deep-tier editorial output for a Story: the facts and the so-what. Either
 * field is `null` when the tier produced nothing usable (a blank model reply, or
 * a resilient degrade on transport failure) — a null MUST NOT overwrite an
 * existing value on upsert (ADR-0047), so callers can tell "no analysis" from
 * "analysis said ''".
 */
export interface StoryAnalysis {
  /** A concise factual recap of what happened (≈2 sentences); null when none. */
  readonly summary: string | null;
  /** The editorial "why it matters" justification; null when none. */
  readonly whyItMatters: string | null;
  /**
   * An English, ≤90-char display headline for a non-English (or otherwise
   * rough) source title — one extra field on the existing deep-tier call, no
   * new spend (Task 20). Null when the tier produced nothing usable; the
   * cleaned original title is the fallback everywhere this is rendered.
   */
  readonly displayTitle: string | null;
}

/** A source item to translate into English (title + optional body). */
export interface TranslateInput {
  readonly title: string;
  readonly text: string | null;
}

/**
 * The cheap-tier English rendering of a non-English item (ADR-0057). Each field
 * is `null` when the tier produced nothing usable, so — exactly like
 * `StoryAnalysis` — a null MUST NOT overwrite an existing value on upsert
 * (ADR-0047).
 */
export interface Translation {
  /** English display headline (≤90 chars); null when none usable. */
  readonly displayTitle: string | null;
  /** A short English factual summary (≈1–2 sentences); null when none. */
  readonly summary: string | null;
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
  /** The factual "what happened" line, so chat can answer "what happened" questions (ADR-0047). */
  readonly summary: string | null;
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
 * action and extracts any explicit time budget; argument validation (positive
 * minutes) stays where the vocabulary lives — the bot.
 */
export interface RouterIntent {
  readonly action: RouterAction;
  /** An explicit time budget the message asked for, else null. */
  readonly minutes: number | null;
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
