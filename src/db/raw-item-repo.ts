import { and, eq, sql } from 'drizzle-orm';
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
  /**
   * Delete raw_items that no Story references via `membership` (ADR-0047). An
   * item is only ever processed the tick it's extracted; if it never joined a
   * surviving Story it is dead provenance that would otherwise accumulate
   * forever. Safe to run after the tick's membership writes are complete.
   * Returns the number of rows removed.
   */
  pruneUnreferenced(): Promise<number>;
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
    if (items.length === 0) return;
    // Batch the per-item upserts instead of one awaited round-trip each (ADR-0051):
    // extraction persists hundreds of items/tick — serial writes to remote Turso were
    // the largest remaining tick-latency source. Chunked to stay within libsql's
    // batch statement cap.
    const stmt = (item: RawItem) =>
      this.db
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
    const CHUNK = 100;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK).map(stmt);
      await this.db.batch(chunk as [typeof chunk[number], ...typeof chunk]);
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

  async pruneUnreferenced(): Promise<number> {
    // NOT EXISTS against membership on the shared (source, external_id) key.
    const res = await this.db.run(sql`
      DELETE FROM raw_items
      WHERE NOT EXISTS (
        SELECT 1 FROM membership
        WHERE membership.source = raw_items.source
          AND membership.external_id = raw_items.external_id
      )`);
    return res.rowsAffected ?? 0;
  }
}
