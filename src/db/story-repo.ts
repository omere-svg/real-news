import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { membership, stories } from './schema.js';
import type { Clock } from '../scheduler/clock.js';
import type {
  Region,
  RawItemRef,
  Story,
  Topic,
} from '../domain/types.js';

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

    return {
      id: row.id,
      title: row.title,
      url: row.url,
      region: row.region,
      topic: row.topic,
      significance: row.significance,
      whyItMatters: row.whyItMatters,
      memberRefs: members.map((m) => ({
        source: m.source,
        externalId: m.externalId,
      })),
      firstSeenAt: row.firstSeenAt,
      updatedAt: row.updatedAt,
    };
  }

  async all(): Promise<Story[]> {
    const rows = await this.db.select().from(stories);
    const result: Story[] = [];
    for (const row of rows) {
      const story = await this.get(row.id);
      if (story) result.push(story);
    }
    return result;
  }
}
