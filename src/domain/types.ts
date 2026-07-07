/**
 * Core domain types for Project Horizon. Vocabulary matches CONTEXT.md exactly.
 * These are contracts — the shapes every seam speaks in.
 */

// --- Partitions (controlled vocabularies, never free text) ---

/**
 * The single partition of a Story. Controlled vocabulary. `Israel` is a topic
 * like any other: a place you can follow, not a separate geographic axis — a
 * story primarily about Israel is classified `Israel` (place wins over subject).
 */
export type Topic =
  | 'AI'
  | 'Geopolitics'
  | 'Politics'
  | 'Sports'
  | 'Business'
  | 'Science'
  | 'Health'
  | 'Climate'
  | 'Israel'
  | 'Other';
export const TOPICS: readonly Topic[] = [
  'AI',
  'Geopolitics',
  'Politics',
  'Sports',
  'Business',
  'Science',
  'Health',
  'Climate',
  'Israel',
  'Other',
] as const;

/**
 * Source identifiers, split by role (ADR-0021 §2, ADR-0025). These arrays are
 * the single source of truth — the types below and the runtime routing in the
 * composition root both derive from them, so the Story/Signal split the ADRs
 * describe is enforced by the compiler, not re-asserted by hand.
 */
export const STORY_SOURCE_IDS = [
  'hackernews',
  'gdelt',
  'arxiv',
  'knesset',
  'secedgar',
  'wikipedia',
  // Phase 4 — media + thematic anchors (ADR-0021).
  'guardian',
  'timesofisrael',
  'knesset-votes',
  'hf-papers',
  'nber',
  'nature',
  'psyarxiv',
  // ADR-0031 — keyless wave: Sports, Health, Climate.
  'thesportsdb', // Sports — live match results/scores
  'who-outbreaks', // Health — WHO Disease Outbreak News
  'nasa-eonet', // Climate — natural-event tracker
  'usgs-quakes', // Climate — significant earthquakes
  'gdacs', // Climate — global disaster alerts (RSS)
] as const;

/** Numeric Signal sources (ADR-0025) — feed significance, never a Story. */
export const SIGNAL_SOURCE_IDS = [
  'wikipedia-pageviews',
  'worldbank',
  // ADR-0031 — keyless wave: Business + Science signal depth.
  'coingecko', // Business — crypto price-momentum
  'frankfurter', // Business — FX volatility
  'openalex', // Science — recent-research citation impact
  // ADR-0041 — GDELT aggregate tone as a Geopolitics intensity signal.
  'gdelt-signal', // Geopolitics — negativity/volume of world-news tone
] as const;

/** Every Source id, both roles — the vocabulary config validates against. */
export const SOURCE_IDS = [...STORY_SOURCE_IDS, ...SIGNAL_SOURCE_IDS] as const;

/** A Story source (emits Raw Items into the pipeline). */
export type StorySourceId = (typeof STORY_SOURCE_IDS)[number];
/** A Signal source (emits numeric observations into scoring context). */
export type SignalSourceId = (typeof SIGNAL_SOURCE_IDS)[number];
/** Identifier of a Source we extract from — either role. */
export type SourceId = StorySourceId | SignalSourceId;

// --- Raw Item: immutable provenance from a single Source ---

/**
 * A verbatim payload from one Source, identified uniquely by (source, externalId).
 * Never mutated after capture.
 */
export interface RawItem {
  readonly source: StorySourceId;
  /** Stable id within the source's namespace (e.g. HN item id, arXiv id). */
  readonly externalId: string;
  readonly title: string;
  readonly url: string | null;
  /** Body/abstract/snippet if the Source provides one. */
  readonly text: string | null;
  /** Unix epoch milliseconds the item was published, if known. */
  readonly publishedAt: number | null;
  /** Source-native metadata, used metadata-first for classification + signals. */
  readonly metadata: SourceMetadata;
}

/**
 * Source-native fields that feed classification (ADR-0009) and scoring signals
 * (ADR-0008). All optional — absence drives the LLM fallback / signal defaults.
 */
export interface SourceMetadata {
  /** Topic the Source asserts, if any (e.g. arXiv category ⇒ AI; Knesset ⇒ Israel). */
  readonly topic?: Topic;
  /** Popularity score the Source exposes (e.g. HN points). */
  readonly points?: number;
  /** Engagement count (e.g. HN comment count, GDELT mention count). */
  readonly mentions?: number;
  /** Sentiment/tone in [-10, 10] if the Source provides it (e.g. GDELT tone). */
  readonly tone?: number;
}

// --- Signals: verifiable inputs to Significance (ADR-0008) ---

/**
 * The deterministic, inspectable inputs to computeBaseScore. Never invented by
 * the model. Assembled per Cluster at the Score stage.
 */
export interface Signals {
  /** Source popularity (e.g. HN points). >= 0. */
  readonly points: number;
  /** Engagement / mention count across the cluster. >= 0. */
  readonly mentions: number;
  /** Tone magnitude/extremity contributes to significance. Range [-10, 10]. */
  readonly tone: number;
  /** Editorial weight of the strongest contributing Source. Range [0, 1]. */
  readonly sourceWeight: number;
  /** Age of the story in hours; older decays the score. >= 0. */
  readonly ageHours: number;
  /** Number of independent Sources corroborating (Cluster size). >= 1. */
  readonly corroboration: number;
}

// --- Score breakdown: the inspectable "why this score" (ADR-0032) ---

/** The axes of the impact-first base score (ADR-0034). */
export type ScoreComponentKey =
  | 'impact'
  | 'corroboration'
  | 'authority'
  | 'attention';

/** One axis's normalized strength in [0, 1] (how much it drove the score). */
export interface ScoreComponent {
  readonly key: ScoreComponentKey;
  /** Normalized strength of this axis, in [0, 1]. */
  readonly value: number;
}

/**
 * The persisted, inspectable explanation of a Story's Significance (ADR-0032/0034).
 * `base` is the impact-first combination of the components, decayed by
 * `recencyFactor`; `base + signalNudge`, clamped, reconciles to the stored
 * `significance`. Snapshotted at scoring time.
 */
export interface ScoreBreakdown {
  /** Impact-first base in [0, 10] (noisy-OR of the importance axes + attention). */
  readonly base: number;
  /** Recency factor in [0, 1] that was applied (floored, never erases — ADR-0034). */
  readonly recencyFactor: number;
  /** The normalized strength of each scoring axis. */
  readonly components: readonly ScoreComponent[];
  /** The model-estimated real-world impact in [0, 1] (ADR-0034). */
  readonly impact: number;
  /** Bounded numeric-Signal nudge from the partition context (signed, ADR-0025). */
  readonly signalNudge: number;
  /** The raw verifiable Signals the base was computed from. */
  readonly signals: Signals;
}

// --- Signal observation: a numeric point from a Signal source (ADR-0025) ---

/**
 * One numeric reading from a Signal source (Wikipedia Pageviews, World Bank).
 * Unlike a `RawItem` it carries no narrative — it feeds significance as scoring
 * context (a bounded partition nudge), never a standalone Story (ADR-0021 §2).
 */
export interface SignalObservation {
  readonly source: SignalSourceId;
  /** Topic this reading informs, or null when it's a global signal (e.g. world attention). */
  readonly topic: Topic | null;
  /** Entity/series identifier (e.g. `he.wikipedia:article:202405`, `USA:NY.GDP.MKTP.CD`). */
  readonly key: string;
  /**
   * Optional normalized real-world entity this reading is *about* (e.g. a person
   * or place — `cristiano ronaldo`), used to nudge the specific matching Story
   * rather than only its Topic (ADR-0043). Absent for series with no clean entity
   * (macro indicators, FX pairs). Lowercased to match `extractEntities`.
   */
  readonly entity?: string;
  /** The reading: view count, macro volatility, … Always >= 0. */
  readonly value: number;
  readonly observedAt: number;
}

// --- Cluster: items judged to be the same Story during a tick ---

export interface Cluster {
  readonly items: readonly RawItem[];
  readonly topic: Topic;
}

// --- Story: the finalized, de-duplicated read-model ---

export interface Story {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly topic: Topic;
  /** Significance in [0.0, 10.0]. */
  readonly significance: number;
  /** A concise factual "what happened" summary. Null until the deep tier writes it. */
  readonly summary: string | null;
  /** The editorial justification. Null until the deep tier analyzes it. */
  readonly whyItMatters: string | null;
  /**
   * An English display headline from the deep tier (Task 20); null until this
   * Story is deep-analyzed (or below top-N). Presentation prefers this over
   * `title` when set.
   */
  readonly displayTitle: string | null;
  /** The inspectable "why this score" (ADR-0032). Null for Stories scored before it. */
  readonly scoreBreakdown: ScoreBreakdown | null;
  /** externalIds of the Raw Items merged into this Story (provenance). */
  readonly memberRefs: readonly RawItemRef[];
  readonly firstSeenAt: number;
  readonly updatedAt: number;
}

export interface RawItemRef {
  readonly source: StorySourceId;
  readonly externalId: string;
}
