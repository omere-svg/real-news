import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type { Region, SourceId, SourceMetadata, Topic } from '../domain/types.js';

/**
 * Two-tier schema (ADR-0005). `raw_items` is immutable provenance keyed by
 * (source, externalId); extraction upserts here idempotently.
 */
export const rawItems = sqliteTable(
  'raw_items',
  {
    source: text('source').$type<SourceId>().notNull(),
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
  region: text('region').$type<Region>().notNull(),
  topic: text('topic').$type<Topic>().notNull(),
  significance: real('significance').notNull(),
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
    source: text('source').$type<SourceId>().notNull(),
    externalId: text('external_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.externalId] }),
    index('membership_story_idx').on(t.storyId),
  ],
);
