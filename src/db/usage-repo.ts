import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { usage } from './schema.js';

/**
 * Durable cost-quota counters (ADR-0022). Each `(key, day)` row counts usage of
 * one quota dimension on one UTC day — e.g. `chat:42:podcast`, `chat:42:cmd`, or
 * the process-wide `global:podcast`. Persisted so a restart can't reset a
 * chat's daily budget.
 */
/** The UTC day key (YYYY-MM-DD) for a quota bucket — shared by every surface that
 * charges the daily counters (the bot and the web podcast) so they agree (ADR-0052). */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface UsageRepo {
  /** Atomically add 1 to `(key, day)` and return the resulting count. */
  incrementAndGet(key: string, day: string): Promise<number>;
  /** Read the current count for `(key, day)` without incrementing (0 if absent).
   * Used to gate an expensive step (an LLM route call) before charging it, so a
   * chat already over quota never spends the model (ADR-0049). */
  peek(key: string, day: string): Promise<number>;
}

export class DrizzleUsageRepo implements UsageRepo {
  constructor(private readonly db: Db) {}

  async incrementAndGet(key: string, day: string): Promise<number> {
    const rows = await this.db
      .insert(usage)
      .values({ key, day, count: 1 })
      .onConflictDoUpdate({
        target: [usage.key, usage.day],
        set: { count: sql`${usage.count} + 1` },
      })
      .returning({ count: usage.count });
    return rows[0]?.count ?? 0;
  }

  async peek(key: string, day: string): Promise<number> {
    const rows = await this.db
      .select({ count: usage.count })
      .from(usage)
      .where(and(eq(usage.key, key), eq(usage.day, day)));
    return rows[0]?.count ?? 0;
  }

  /**
   * Atomically add `amount` to `(key, day)` — the token-accounting counters
   * (`global:tokens:<tier>`), which grow by hundreds per completion rather than
   * by 1 per request. Not on `UsageRepo`: quota call sites only ever charge 1.
   */
  async add(key: string, day: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.db
      .insert(usage)
      .values({ key, day, count: amount })
      .onConflictDoUpdate({
        target: [usage.key, usage.day],
        set: { count: sql`${usage.count} + ${amount}` },
      });
  }
}
