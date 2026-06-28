import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type { SourceMetadata, StorySourceId, Topic } from '../domain/types.js';
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
