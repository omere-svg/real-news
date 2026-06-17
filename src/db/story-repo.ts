import {
  and,
  desc,
  eq,
  gte,
  inArray,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import type { Db } from './client.js';
import { membership, stories, storyVectors } from './schema.js';
import type { Clock } from '../scheduler/clock.js';
import type {
  Region,
  RawItemRef,
  Story,
  Topic,
} from '../domain/types.js';

/**
 * Read-side filter for the presentation layer (ADR-0011). `region`/`topic`
 * accept a single value or an array (SQL `IN`); an empty array is no filter.
 */
export interface StoryQuery {
  readonly region?: Region | readonly Region[];
  readonly topic?: Topic | readonly Topic[];
  readonly minSignificance?: number;
  readonly limit?: number;
}

/** A stored Story embedding, returned by the cross-tick blocking query (ADR-0017). */
export interface StoredVector {
  readonly storyId: string;
  readonly vector: number[];
}

/** Blocking filter for cross-tick dedup: same partition, recent window (ADR-0017). */
export interface RecentVectorsQuery {
  readonly region: Region;
  readonly topic: Topic;
  /** Lower bound on `updatedAt` — the recency window. */
  readonly sinceMs: number;
}

/** What the pipeline hands the repo to create or update a Story. */
export interface StoryUpsert {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly region: Region;
  readonly topic: Topic;
  readonly significance: number;
  readonly whyItMatters: string | null;
  readonly memberRefs: readonly RawItemRef[];
}

/**
 * The Story store. Create-or-update by `id` (the Active Editor refreshes a
 * Story in place as it develops); manages the membership rows that carry the
 * corroboration signal (ADR-0005).
 */
export interface StoryRepo {
  upsert(input: StoryUpsert): Promise<Story>;
  get(id: string): Promise<Story | null>;
  all(): Promise<Story[]>;
  /** Stories matching the filter, ordered by Significance descending. */
  topStories(query: StoryQuery): Promise<Story[]>;
  /** Store/replace a Story's representative embedding (ADR-0017). */
  putVector(storyId: string, vector: number[]): Promise<void>;
  /** Stored vectors for recent Stories in one partition — the cross-tick blocking set. */
  recentVectors(query: RecentVectorsQuery): Promise<StoredVector[]>;
}

export class DrizzleStoryRepo implements StoryRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async upsert(input: StoryUpsert): Promise<Story> {
    const now = this.clock.now();

    await this.db
      .insert(stories)
      .values({
        id: input.id,
        title: input.title,
        url: input.url,
        region: input.region,
        topic: input.topic,
        significance: input.significance,
        whyItMatters: input.whyItMatters,
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: stories.id,
        set: {
          title: input.title,
          url: input.url,
          region: input.region,
          topic: input.topic,
          significance: input.significance,
          whyItMatters: input.whyItMatters,
          updatedAt: now,
        },
      });

    // Replace this story's membership with the given refs.
    await this.db.delete(membership).where(eq(membership.storyId, input.id));
    if (input.memberRefs.length > 0) {
      await this.db.insert(membership).values(
        input.memberRefs.map((ref) => ({
          storyId: input.id,
          source: ref.source,
          externalId: ref.externalId,
        })),
      );
    }

    const story = await this.get(input.id);
    if (!story) {
      throw new Error(`Story ${input.id} vanished immediately after upsert`);
    }
    return story;
  }

  async get(id: string): Promise<Story | null> {
    const rows = await this.db
      .select()
      .from(stories)
      .where(eq(stories.id, id));
    const row = rows[0];
    if (!row) return null;

    const members = await this.db
      .select()
      .from(membership)
      .where(eq(membership.storyId, id));

    return rowToStory(
      row,
      members.map((m) => ({ source: m.source, externalId: m.externalId })),
    );
  }

  async all(): Promise<Story[]> {
    return this.hydrate(await this.db.select().from(stories));
  }

  async topStories(query: StoryQuery): Promise<Story[]> {
    const filters: SQL[] = [];
    const region = matchFilter(stories.region, query.region);
    if (region) filters.push(region);
    const topic = matchFilter(stories.topic, query.topic);
    if (topic) filters.push(topic);
    if (query.minSignificance !== undefined) {
      filters.push(gte(stories.significance, query.minSignificance));
    }

    const base = this.db
      .select()
      .from(stories)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(stories.significance));

    const rows = await (query.limit !== undefined
      ? base.limit(query.limit)
      : base);
    return this.hydrate(rows);
  }

  async putVector(storyId: string, vector: number[]): Promise<void> {
    await this.db
      .insert(storyVectors)
      .values({ storyId, vector })
      .onConflictDoUpdate({ target: storyVectors.storyId, set: { vector } });
  }

  async recentVectors(query: RecentVectorsQuery): Promise<StoredVector[]> {
    const rows = await this.db
      .select({ storyId: storyVectors.storyId, vector: storyVectors.vector })
      .from(storyVectors)
      .innerJoin(stories, eq(storyVectors.storyId, stories.id))
      .where(
        and(
          eq(stories.region, query.region),
          eq(stories.topic, query.topic),
          gte(stories.updatedAt, query.sinceMs),
        ),
      );
    return rows.map((r) => ({ storyId: r.storyId, vector: r.vector }));
  }

  /** Attach memberRefs to a page of story rows in ONE membership query (no N+1). */
  private async hydrate(
    rows: (typeof stories.$inferSelect)[],
  ): Promise<Story[]> {
    if (rows.length === 0) return [];

    const members = await this.db
      .select()
      .from(membership)
      .where(
        inArray(
          membership.storyId,
          rows.map((r) => r.id),
        ),
      );

    const refsByStory = new Map<string, RawItemRef[]>();
    for (const m of members) {
      const refs = refsByStory.get(m.storyId) ?? [];
      refs.push({ source: m.source, externalId: m.externalId });
      refsByStory.set(m.storyId, refs);
    }

    return rows.map((row) => rowToStory(row, refsByStory.get(row.id) ?? []));
  }
}

/**
 * Build an `eq` (single) or `IN` (array) predicate for a column; `null` when
 * there is nothing to filter (undefined, or an empty array).
 */
function matchFilter<T extends string>(
  column: AnyColumn,
  value: T | readonly T[] | undefined,
): SQL | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    return value.length ? inArray(column, value as T[]) : null;
  }
  return eq(column, value as T);
}

/** Map a story row + its member refs to a domain Story. */
function rowToStory(
  row: typeof stories.$inferSelect,
  memberRefs: RawItemRef[],
): Story {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    region: row.region,
    topic: row.topic,
    significance: row.significance,
    whyItMatters: row.whyItMatters,
    memberRefs,
    firstSeenAt: row.firstSeenAt,
    updatedAt: row.updatedAt,
  };
}
