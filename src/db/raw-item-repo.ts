import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { rawItems } from './schema.js';
import type { RawItem, RawItemRef } from '../domain/types.js';

/**
 * The Raw Item store. Idempotent upsert by (source, externalId) makes
 * re-running a tick safe (ADR-0005); update-in-place lets the Active Editor
 * refresh mutable signals (points/mentions) as a story develops.
 */
export interface RawItemRepo {
  upsert(items: readonly RawItem[]): Promise<void>;
  get(ref: RawItemRef): Promise<RawItem | null>;
  all(): Promise<RawItem[]>;
}

type Row = typeof rawItems.$inferSelect;

function toDomain(row: Row): RawItem {
  return {
    source: row.source,
    externalId: row.externalId,
    title: row.title,
    url: row.url,
    text: row.text,
    publishedAt: row.publishedAt,
    metadata: row.metadata,
  };
}

export class DrizzleRawItemRepo implements RawItemRepo {
  constructor(private readonly db: Db) {}

  async upsert(items: readonly RawItem[]): Promise<void> {
    for (const item of items) {
      await this.db
        .insert(rawItems)
        .values({
          source: item.source,
          externalId: item.externalId,
          title: item.title,
          url: item.url,
          text: item.text,
          publishedAt: item.publishedAt,
          metadata: item.metadata,
        })
        .onConflictDoUpdate({
          target: [rawItems.source, rawItems.externalId],
          set: {
            title: item.title,
            url: item.url,
            text: item.text,
            publishedAt: item.publishedAt,
            metadata: item.metadata,
          },
        });
    }
  }

  async get(ref: RawItemRef): Promise<RawItem | null> {
    const rows = await this.db
      .select()
      .from(rawItems)
      .where(
        and(
          eq(rawItems.source, ref.source),
          eq(rawItems.externalId, ref.externalId),
        ),
      );
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async all(): Promise<RawItem[]> {
    const rows = await this.db.select().from(rawItems);
    return rows.map(toDomain);
  }
}
