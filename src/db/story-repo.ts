import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  or,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import type { Db } from './client.js';
import { membership, stories, storyVectors } from './schema.js';
import type { Clock } from '../scheduler/clock.js';
import { cosine } from '../embedding/cosine.js';
import type {
  RawItemRef,
  ScoreBreakdown,
  Story,
  Topic,
} from '../domain/types.js';

/**
 * Read-side filter for the presentation layer (ADR-0011). `topic` accepts a
 * single value or an array (SQL `IN`); an empty array is no filter.
 */
export interface StoryQuery {
  readonly topic?: Topic | readonly Topic[];
  readonly minSignificance?: number;
  readonly limit?: number;
}

/** A stored Story embedding, returned by the cross-tick blocking query (ADR-0017). */
export interface StoredVector {
  readonly storyId: string;
  readonly vector: number[];
}

/** The editorial fields the tick preserves across a re-upsert (ADR-0047). */
export interface StoryAnalysisFields {
  readonly summary: string | null;
  readonly whyItMatters: string | null;
}

/** Blocking filter for cross-tick dedup: recent window, optionally one topic (ADR-0017/0038). */
export interface RecentVectorsQuery {
  /** Restrict to this Topic; omit to match across all Topics (cross-topic resolve, ADR-0038). */
  readonly topic?: Topic;
  /** Lower bound on `updatedAt` — the recency window. */
  readonly sinceMs: number;
}

/** Semantic-search filter over stored Story embeddings (ADR-0045). */
export interface SemanticQuery {
  /** The query embedding to rank Stories against by cosine similarity. */
  readonly vector: readonly number[];
  /** Max Stories to return. */
  readonly limit: number;
  /** Restrict to these Topics (SQL `IN`); omit/empty for all Topics. */
  readonly topic?: Topic | readonly Topic[];
  /** Skip matches below this cosine similarity (0 ⇒ no floor). */
  readonly minSimilarity?: number;
}

/** What the pipeline hands the repo to create or update a Story. */
export interface StoryUpsert {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly topic: Topic;
  readonly significance: number;
  /** Factual "what happened" summary; omit/null when not analyzed this tick. */
  readonly summary?: string | null;
  readonly whyItMatters: string | null;
  /** Inspectable "why this score" snapshot (ADR-0032); omit/null when unavailable. */
  readonly scoreBreakdown?: ScoreBreakdown | null;
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
  /**
   * The current summary/whyItMatters for a set of Story ids, in one query. The
   * tick reads this before re-upserting so a cheap re-run (non-top-N) preserves
   * the deep analysis a prior tick wrote instead of clobbering it (ADR-0047).
   */
  existingAnalysis(ids: readonly string[]): Promise<Map<string, StoryAnalysisFields>>;
  /** Stories matching the filter, ordered by Significance descending. */
  topStories(query: StoryQuery): Promise<Story[]>;
  /** Store/replace a Story's representative embedding (ADR-0017). */
  putVector(storyId: string, vector: number[]): Promise<void>;
  /** Stored vectors for recent Stories in one partition — the cross-tick blocking set. */
  recentVectors(query: RecentVectorsQuery): Promise<StoredVector[]>;
  /**
   * Stored vectors for exactly these Story ids, in one query (ADR-0053) —
   * the presentation layer's same-event diversity guard. Ids with no stored
   * vector are simply absent from the map.
   */
  vectorsFor(ids: readonly string[]): Promise<Map<string, number[]>>;
  /**
   * Stories ranked by cosine similarity of their stored embedding to a query
   * vector (ADR-0045) — semantic retrieval for chat grounding. Returns the top
   * `limit` above `minSimilarity`, most-similar first.
   */
  semanticSearch(query: SemanticQuery): Promise<Story[]>;
  /**
   * Delete Stories that have no membership rows (and their vectors). Members can
   * be reassigned to another Story across ticks, which can leave the prior owner
   * empty; a per-tick sweep keeps the read-model clean (ADR-0038). Returns the
   * number of Stories pruned.
   */
  pruneOrphans(): Promise<number>;
}

export class DrizzleStoryRepo implements StoryRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async upsert(input: StoryUpsert): Promise<Story> {
    const now = this.clock.now();

    const storyWrite = this.db
      .insert(stories)
      .values({
        id: input.id,
        title: input.title,
        url: input.url,
        topic: input.topic,
        significance: input.significance,
        summary: input.summary ?? null,
        whyItMatters: input.whyItMatters,
        scoreBreakdown: input.scoreBreakdown ?? null,
        firstSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: stories.id,
        set: {
          title: input.title,
          url: input.url,
          topic: input.topic,
          significance: input.significance,
          summary: input.summary ?? null,
          whyItMatters: input.whyItMatters,
          scoreBreakdown: input.scoreBreakdown ?? null,
          updatedAt: now,
        },
      });

    // Replace this story's membership with the given refs. Clear both this
    // story's existing rows AND any rows that currently own an incoming ref —
    // clustering can reassign a source item from another story across ticks,
    // and the (source, externalId) primary key lets a ref belong to one story
    // only, so the prior owner must release it before we re-insert.
    const ownsIncoming = input.memberRefs.map((ref) =>
      and(eq(membership.source, ref.source), eq(membership.externalId, ref.externalId)),
    );
    const clearMembership = this.db
      .delete(membership)
      .where(or(eq(membership.storyId, input.id), ...ownsIncoming));

    // One atomic batch (a libsql transaction): the story write, the membership
    // release, and the re-insert commit together or not at all. Previously these
    // were three separate awaits — a failure between the DELETE and the INSERT
    // orphaned this story (and any raided prior owner), which the tick's
    // `finally` pruneOrphans then deleted along with its paid summary (ADR-0049).
    if (input.memberRefs.length > 0) {
      const insertMembership = this.db.insert(membership).values(
        input.memberRefs.map((ref) => ({
          storyId: input.id,
          source: ref.source,
          externalId: ref.externalId,
        })),
      );
      await this.db.batch([storyWrite, clearMembership, insertMembership]);
    } else {
      await this.db.batch([storyWrite, clearMembership]);
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

  async existingAnalysis(
    ids: readonly string[],
  ): Promise<Map<string, StoryAnalysisFields>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: stories.id,
        summary: stories.summary,
        whyItMatters: stories.whyItMatters,
      })
      .from(stories)
      .where(inArray(stories.id, ids as string[]));
    return new Map(
      rows.map((r) => [r.id, { summary: r.summary, whyItMatters: r.whyItMatters }]),
    );
  }

  async topStories(query: StoryQuery): Promise<Story[]> {
    const filters: SQL[] = [];
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

  async semanticSearch(query: SemanticQuery): Promise<Story[]> {
    const topic = matchFilter(stories.topic, query.topic);
    const rows = await this.db
      .select({
        story: stories,
        vector: storyVectors.vector,
      })
      .from(storyVectors)
      .innerJoin(stories, eq(storyVectors.storyId, stories.id))
      .where(topic ?? undefined);

    const floor = query.minSimilarity ?? 0;
    const ranked = rows
      .map((r) => ({ row: r.story, sim: cosine(query.vector, r.vector) }))
      .filter((r) => r.sim >= floor)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, Math.max(0, query.limit));

    return this.hydrate(ranked.map((r) => r.row));
  }

  async vectorsFor(ids: readonly string[]): Promise<Map<string, number[]>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ storyId: storyVectors.storyId, vector: storyVectors.vector })
      .from(storyVectors)
      .where(inArray(storyVectors.storyId, ids as string[]));
    return new Map(rows.map((r) => [r.storyId, r.vector]));
  }

  async recentVectors(query: RecentVectorsQuery): Promise<StoredVector[]> {
    const filters: SQL[] = [gte(stories.updatedAt, query.sinceMs)];
    if (query.topic !== undefined) filters.push(eq(stories.topic, query.topic));
    const rows = await this.db
      .select({ storyId: storyVectors.storyId, vector: storyVectors.vector })
      .from(storyVectors)
      .innerJoin(stories, eq(storyVectors.storyId, stories.id))
      .where(and(...filters));
    return rows.map((r) => ({ storyId: r.storyId, vector: r.vector }));
  }

  async pruneOrphans(): Promise<number> {
    // Stories with zero membership rows (left-join → null member side).
    const orphans = await this.db
      .select({ id: stories.id })
      .from(stories)
      .leftJoin(membership, eq(stories.id, membership.storyId))
      .where(isNull(membership.storyId));
    const ids = orphans.map((r) => r.id);
    if (ids.length === 0) return 0;

    // Vectors first: story_vectors.story_id references stories.id.
    await this.db.delete(storyVectors).where(inArray(storyVectors.storyId, ids));
    await this.db.delete(stories).where(inArray(stories.id, ids));
    return ids.length;
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
    topic: row.topic,
    significance: row.significance,
    summary: row.summary,
    whyItMatters: row.whyItMatters,
    scoreBreakdown: row.scoreBreakdown ?? null,
    memberRefs,
    firstSeenAt: row.firstSeenAt,
    updatedAt: row.updatedAt,
  };
}
