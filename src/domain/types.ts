/**
 * Core domain types for Project Horizon. Vocabulary matches CONTEXT.md exactly.
 * These are contracts — the shapes every seam speaks in.
 */

// --- Partitions (controlled vocabularies, never free text) ---

/** The geographic partition of a Story. Closed set in Phase 1. */
export type Region = 'Israel' | 'World';
export const REGIONS: readonly Region[] = ['Israel', 'World'] as const;

/** The domain partition of a Story. Controlled vocabulary. */
export type Topic =
  | 'AI'
  | 'Geopolitics'
  | 'Politics'
  | 'Sports'
  | 'Business'
  | 'Science'
  | 'Other';
export const TOPICS: readonly Topic[] = [
  'AI',
  'Geopolitics',
  'Politics',
  'Sports',
  'Business',
  'Science',
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
  'datagovil',
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
] as const;

/** Numeric Signal sources (ADR-0025) — feed significance, never a Story. */
export const SIGNAL_SOURCE_IDS = ['wikipedia-pageviews', 'worldbank'] as const;

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
  /** Region the Source asserts, if any (e.g. data.gov.il ⇒ Israel). */
  readonly region?: Region;
  /** Topic the Source asserts, if any (e.g. arXiv category ⇒ AI/Science). */
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

// --- Signal observation: a numeric point from a Signal source (ADR-0025) ---

/**
 * One numeric reading from a Signal source (Wikipedia Pageviews, World Bank).
 * Unlike a `RawItem` it carries no narrative — it feeds significance as scoring
 * context (a bounded partition nudge), never a standalone Story (ADR-0021 §2).
 */
export interface SignalObservation {
  readonly source: SignalSourceId;
  /** Partition this reading informs. */
  readonly region: Region;
  /** Finer partition, or null when the signal is region-wide (e.g. attention). */
  readonly topic: Topic | null;
  /** Entity/series identifier (e.g. `he.wikipedia:article:202405`, `USA:NY.GDP.MKTP.CD`). */
  readonly key: string;
  /** The reading: view count, macro volatility, … Always >= 0. */
  readonly value: number;
  readonly observedAt: number;
}

// --- Cluster: items judged to be the same Story during a tick ---

export interface Cluster {
  readonly items: readonly RawItem[];
  readonly region: Region;
  readonly topic: Topic;
}

// --- Story: the finalized, de-duplicated read-model ---

export interface Story {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly region: Region;
  readonly topic: Topic;
  /** Significance in [0.0, 10.0]. */
  readonly significance: number;
  /** The editorial justification. Null until the Opus tier analyzes it. */
  readonly whyItMatters: string | null;
  /** externalIds of the Raw Items merged into this Story (provenance). */
  readonly memberRefs: readonly RawItemRef[];
  readonly firstSeenAt: number;
  readonly updatedAt: number;
}

export interface RawItemRef {
  readonly source: StorySourceId;
  readonly externalId: string;
}
