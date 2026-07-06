import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { and, eq, lt, or } from 'drizzle-orm';
import type { Db } from './client.js';
import { tickLock } from './schema.js';

/**
 * A single-row cross-process advisory lock for the tick loop (ADR-0047).
 *
 * The pipeline is not safe to run concurrently against one database: two writers
 * double-count corroboration, race membership reassignment, and each prune what
 * the other just wrote. That happens the moment a lingering local run points at
 * the same Turso DB as the deployed instance. This lock lets exactly one process
 * tick at a time; a crashed holder's lock expires after a TTL so the system
 * self-heals without manual intervention.
 *
 * It is *advisory* (every writer must ask) and coarse (one lock for the whole
 * tick) — deliberately simple. The real fix is one writer per DB; this is the
 * backstop that keeps a mistake from corrupting the store.
 */
export interface TickLock {
  /**
   * Try to hold the lock until `now + ttlMs`. Returns true iff this process now
   * holds it (either it was free/expired, or we already held it). A false return
   * means another live process holds it — the caller should skip this tick.
   */
  acquire(now: number, ttlMs: number): Promise<boolean>;
  /** Release the lock if this process holds it (no-op otherwise). */
  release(): Promise<void>;
}

export class DrizzleTickLock implements TickLock {
  /** This process's opaque holder id — unique per run so releases can't collide. */
  private readonly holder = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
  private ensured = false;

  constructor(private readonly db: Db) {}

  /** Ensure the singleton row exists before the first conditional update. */
  private async ensureRow(): Promise<void> {
    if (this.ensured) return;
    await this.db
      .insert(tickLock)
      .values({ id: 1, lockedUntil: 0, holder: null })
      .onConflictDoNothing();
    this.ensured = true;
  }

  async acquire(now: number, ttlMs: number): Promise<boolean> {
    await this.ensureRow();
    // Atomic grab: stamp the row when the current lock is free/expired, OR when
    // we already hold it (renew our own lease). SQLite serializes writers, so of
    // two racing processes exactly one UPDATE matches; the loser's WHERE no longer
    // holds and it writes nothing.
    await this.db
      .update(tickLock)
      .set({ lockedUntil: now + ttlMs, holder: this.holder })
      .where(
        and(
          eq(tickLock.id, 1),
          or(lt(tickLock.lockedUntil, now), eq(tickLock.holder, this.holder)),
        ),
      );

    // Read back: we hold it iff the row now carries our holder + expiry.
    const rows = await this.db.select().from(tickLock).where(eq(tickLock.id, 1));
    const row = rows[0];
    return row?.holder === this.holder && row.lockedUntil === now + ttlMs;
  }

  async release(): Promise<void> {
    await this.db
      .update(tickLock)
      .set({ lockedUntil: 0, holder: null })
      .where(and(eq(tickLock.id, 1), eq(tickLock.holder, this.holder)));
  }
}
