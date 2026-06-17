import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { usage } from './schema.js';

/**
 * Durable cost-quota counters (ADR-0022). Each `(key, day)` row counts usage of
 * one quota dimension on one UTC day — e.g. `chat:42:podcast`, `chat:42:cmd`, or
 * the process-wide `global:podcast`. Persisted so a restart can't reset a
 * chat's daily budget.
 */
export interface UsageRepo {
  /** Atomically add 1 to `(key, day)` and return the resulting count. */
  incrementAndGet(key: string, day: string): Promise<number>;
}

export class DrizzleUsageRepo implements UsageRepo {
  constructor(private readonly db: Db) {}

  async incrementAndGet(key: string, day: string): Promise<number> {
    await this.db
      .insert(usage)
      .values({ key, day, count: 1 })
      .onConflictDoUpdate({
        target: [usage.key, usage.day],
        set: { count: sql`${usage.count} + 1` },
      });

    const rows = await this.db
      .select({ count: usage.count })
      .from(usage)
      .where(and(eq(usage.key, key), eq(usage.day, day)));
    return rows[0]?.count ?? 0;
  }
}
