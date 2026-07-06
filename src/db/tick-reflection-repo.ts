import { desc, notInArray } from 'drizzle-orm';
import type { Db } from './client.js';
import { tickReflections } from './schema.js';

/**
 * One persisted reflection advisory (ADR-0042): the LLM's conclusions drawn from
 * a group of recent ticks, with when it was written and how many ticks it covered.
 */
export interface TickReflection {
  readonly id: number;
  readonly createdAt: number;
  readonly ticksCovered: number;
  readonly text: string;
}

/** What the loop hands the repo to persist a fresh reflection. */
export interface TickReflectionInput {
  readonly createdAt: number;
  readonly ticksCovered: number;
  readonly text: string;
}

/** The reflection store (ADR-0042). */
export interface TickReflectionRepo {
  record(rec: TickReflectionInput): Promise<void>;
  /** The most recent advisories, newest first. */
  recent(limit: number): Promise<TickReflection[]>;
  /** Delete all but the most recent `keep` advisories. Returns rows removed. */
  pruneToRecent(keep: number): Promise<number>;
}

export class DrizzleTickReflectionRepo implements TickReflectionRepo {
  constructor(private readonly db: Db) {}

  async record(rec: TickReflectionInput): Promise<void> {
    await this.db.insert(tickReflections).values({
      createdAt: rec.createdAt,
      ticksCovered: rec.ticksCovered,
      text: rec.text,
    });
  }

  async recent(limit: number): Promise<TickReflection[]> {
    const rows = await this.db
      .select()
      .from(tickReflections)
      .orderBy(desc(tickReflections.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      ticksCovered: r.ticksCovered,
      text: r.text,
    }));
  }

  async pruneToRecent(keep: number): Promise<number> {
    if (keep <= 0) return 0;
    const survivors = await this.db
      .select({ id: tickReflections.id })
      .from(tickReflections)
      .orderBy(desc(tickReflections.createdAt))
      .limit(keep);
    if (survivors.length < keep) return 0;
    const keepIds = survivors.map((r) => r.id);
    const stale = await this.db
      .select({ id: tickReflections.id })
      .from(tickReflections)
      .where(notInArray(tickReflections.id, keepIds));
    if (stale.length === 0) return 0;
    await this.db.delete(tickReflections).where(notInArray(tickReflections.id, keepIds));
    return stale.length;
  }
}
