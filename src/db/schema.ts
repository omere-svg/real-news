import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type {
  ScoreBreakdown,
  SignalSourceId,
  SourceId,
  SourceMetadata,
  StorySourceId,
  Topic,
} from '../domain/types.js';
import type { SourceFailure } from '../pipeline/extract.js';
import type { PreviousPreferences } from './chat-preferences-repo.js';

/**
 * Two-tier schema (ADR-0005). `raw_items` is immutable provenance keyed by
 * (source, externalId); extraction upserts here idempotently.
 */
export const rawItems = sqliteTable(
  'raw_items',
  {
    source: text('source').$type<StorySourceId>().notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    text: text('text'),
    publishedAt: integer('published_at'),
    metadata: text('metadata', { mode: 'json' })
      .$type<SourceMetadata>()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.externalId] })],
);

/**
 * `stories` is the finalized, de-duplicated read-model the presentation layer
 * consumes (ADR-0005). `id` is caller-assigned (the pipeline decides identity).
 */
export const stories = sqliteTable('stories', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  url: text('url'),
  topic: text('topic').$type<Topic>().notNull(),
  significance: real('significance').notNull(),
  summary: text('summary'),
  whyItMatters: text('why_it_matters'),
  // Inspectable "why this score" snapshot (ADR-0032); null for pre-0032 stories.
  scoreBreakdown: text('score_breakdown', { mode: 'json' }).$type<ScoreBreakdown>(),
  firstSeenAt: integer('first_seen_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * `story_vectors` holds the representative embedding of each Story (ADR-0017),
 * so a later tick can cosine-match new items against Stories from prior ticks
 * and merge — cross-tick dedup. One vector per Story.
 */
export const storyVectors = sqliteTable('story_vectors', {
  storyId: text('story_id')
    .primaryKey()
    .references(() => stories.id),
  vector: text('vector', { mode: 'json' }).$type<number[]>().notNull(),
});

/**
 * `membership` links many Raw Items → one Story. Its distinct-source count is
 * the corroboration signal (ADR-0005/0008). A Raw Item belongs to at most one
 * Story, so (source, externalId) is the key.
 */
export const membership = sqliteTable(
  'membership',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id),
    source: text('source').$type<StorySourceId>().notNull(),
    externalId: text('external_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.externalId] }),
    index('membership_story_idx').on(t.storyId),
  ],
);

/**
 * `chat_preferences` holds per-chat presentation preferences for the Telegram
 * bot (ADR-0019). Keyed by Telegram `chatId`. All preference columns are
 * nullable — an unset column falls back to the config defaults (ADR-0015).
 */
export const chatPreferences = sqliteTable('chat_preferences', {
  chatId: integer('chat_id').primaryKey(),
  topics: text('topics', { mode: 'json' }).$type<Topic[]>(),
  defaultMinutes: real('default_minutes'),
  // Soft preference weights from free-text feedback (ADR-0026); absent ≡ neutral.
  topicWeights: text('topic_weights', { mode: 'json' }).$type<Partial<Record<Topic, number>>>(),
  // One-level undo snapshot of the feedback-affected fields (ADR-0026).
  prev: text('prev', { mode: 'json' }).$type<PreviousPreferences>(),
  // Free-text "things that matter to me" injected into the LLM content paths
  // (podcast narration, chat) on every request (ADR-0028); absent ≡ none.
  memory: text('memory'),
});

/**
 * `tick_reports` is the observability log (ADR-0033): one row per tick, recording
 * its outcome — counts, duration, ok/error, and the skipped/failed source lists.
 * Failed ticks are recorded too (`ok = false`). Indexed by `ranAt` for the
 * "most recent N" read the dashboard uses.
 */
export const tickReports = sqliteTable(
  'tick_reports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ranAt: integer('ran_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    error: text('error'),
    extracted: integer('extracted').notNull(),
    storiesUpserted: integer('stories_upserted').notNull(),
    signalsObserved: integer('signals_observed').notNull(),
    skipped: text('skipped', { mode: 'json' }).$type<SourceId[]>().notNull(),
    failed: text('failed', { mode: 'json' }).$type<SourceFailure[]>().notNull(),
    signalsSkipped: text('signals_skipped', { mode: 'json' }).$type<SourceId[]>().notNull(),
    signalsFailed: text('signals_failed', { mode: 'json' }).$type<SourceFailure[]>().notNull(),
  },
  (t) => [index('tick_reports_ran_at_idx').on(t.ranAt)],
);

/**
 * `signal_observations` persists each tick's numeric Signal readings (ADR-0044),
 * so a later tick can compare a series to its prior reading and reward a **rising**
 * signal — a trend, not just a snapshot. One row per observation; `key` is the
 * series identifier (stable within its period, e.g. `coingecko:bitcoin:YYYYMMDD`),
 * indexed with `observedAt` for the "latest prior value per key" read. Pruned to a
 * bounded window each tick (ADR-0042).
 */
export const signalObservations = sqliteTable(
  'signal_observations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').$type<SignalSourceId>().notNull(),
    key: text('key').notNull(),
    topic: text('topic').$type<Topic>(),
    value: real('value').notNull(),
    observedAt: integer('observed_at').notNull(),
  },
  (t) => [
    index('signal_obs_key_idx').on(t.key, t.observedAt),
    index('signal_obs_observed_idx').on(t.observedAt),
  ],
);

/**
 * `tick_reflections` persists the LLM "reflection" advisories (ADR-0042): every
 * so often the reasoner reads the last few tick reports as a group and writes a
 * short conclusions/what-to-improve note. Surfaced on `/dashboard` + `/api/reflection`.
 * Kept to a bounded recent window (ADR-0042).
 */
export const tickReflections = sqliteTable(
  'tick_reflections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    createdAt: integer('created_at').notNull(),
    /** How many recent ticks the advisory was drawn from. */
    ticksCovered: integer('ticks_covered').notNull(),
    /** The advisory text (concise markdown/plain text). */
    text: text('text').notNull(),
  },
  (t) => [index('tick_reflections_created_idx').on(t.createdAt)],
);

/**
 * `usage` is the durable cost-quota counter (ADR-0022): one row per
 * (`key`, `day`) — e.g. `chat:42:podcast` or `global:podcast` for a UTC day.
 * Persisted so a process restart can't reset a chat's daily budget.
 */
export const usage = sqliteTable(
  'usage',
  {
    key: text('key').notNull(),
    day: text('day').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.day] })],
);

/**
 * `web_sessions` backs the web "Log in with Telegram" pairing (ADR-0040) — a
 * free, SMS-less way to link the web viewer to a Telegram user. The browser
 * holds an opaque `token` in an httpOnly cookie. `chatId` is null until the
 * paired Telegram chat claims the session's link code, at which point the web
 * visitor *is* that Telegram user and shares its `chat_preferences` row. `name`
 * is the Telegram first name, kept only for a friendly greeting.
 */
export const webSessions = sqliteTable('web_sessions', {
  token: text('token').primaryKey(),
  chatId: integer('chat_id'),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

/**
 * `tick_lock` is a single-row cross-process advisory lock (ADR-0047). When more
 * than one process points at the same database (a lingering local run beside the
 * deployed one), both would tick and double-write — corrupting counts and racing
 * membership. A process acquires the lock by conditionally stamping
 * `lockedUntil` into the future; a crashed holder's lock simply expires. One row
 * (id = 1) is enough; the TTL bounds a stuck holder.
 */
export const tickLock = sqliteTable('tick_lock', {
  id: integer('id').primaryKey(),
  /** Epoch ms until which the lock is held; a past value means free. */
  lockedUntil: integer('locked_until').notNull(),
  /** Opaque id of the current holder (host+pid+random), for release + debugging. */
  holder: text('holder'),
});

/**
 * `link_codes` are the short-lived, single-use pairing codes shown on the web
 * and claimed by the Telegram bot via a `t.me/<bot>?start=link_<code>` deep
 * link (or `/link <code>`). Claiming stamps `chatId`/`name`; the next web status
 * poll promotes those onto the owning session and deletes the code (ADR-0040).
 */
export const linkCodes = sqliteTable(
  'link_codes',
  {
    code: text('code').primaryKey(),
    /** The web session (token) this code pairs. */
    token: text('token').notNull(),
    /** Set by the bot when a Telegram chat claims the code. */
    chatId: integer('chat_id'),
    name: text('name'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('link_codes_token_idx').on(t.token)],
);
