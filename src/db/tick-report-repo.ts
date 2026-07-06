import { desc, notInArray } from 'drizzle-orm';
import type { Db } from './client.js';
import { tickReports } from './schema.js';
import type { SourceId } from '../domain/types.js';
import type { SourceFailure } from '../pipeline/extract.js';
import type { TickReport } from '../pipeline/tick-runner.js';

/**
 * One persisted tick outcome (ADR-0033): the `TickReport` plus when it ran, how
 * long it took, and whether it succeeded. Failed ticks are recorded with
 * `ok = false` and an `error` message.
 */
export interface TickRecord extends TickReport {
  /** Epoch ms the tick started. */
  readonly ranAt: number;
  /** Wall-clock duration of the tick in ms. */
  readonly durationMs: number;
  /** False when the tick threw; the loop records it anyway. */
  readonly ok: boolean;
  /** Error message when `ok` is false; also carries the skip reason for
   * lock-skipped ticks (recorded with `ok = true`, ADR-0048). */
  readonly error: string | null;
}

/**
 * The TickRecord written when a tick is skipped because another process holds
 * the advisory lock (ADR-0048). ok=true (a skip is not a failure) with the
 * reason in `error`, so /api/ticks and /dashboard show WHY nothing ran —
 * absence alone is indistinguishable from a dead process.
 */
export function lockSkipRecord(ranAt: number): TickRecord {
  return {
    ranAt,
    durationMs: 0,
    ok: true,
    error: 'tick skipped: lock held by another process',
    extracted: 0,
    storiesUpserted: 0,
    signalsObserved: 0,
    skipped: [],
    failed: [],
    signalsSkipped: [],
    signalsFailed: [],
  };
}

/** The observability log store (ADR-0033). */
export interface TickReportRepo {
  record(rec: TickRecord): Promise<void>;
  /** The most recent records, newest first. */
  recent(limit: number): Promise<TickRecord[]>;
  /** Delete all but the most recent `keep` records (ADR-0042). Returns rows removed. */
  pruneToRecent(keep: number): Promise<number>;
}

export class DrizzleTickReportRepo implements TickReportRepo {
  constructor(private readonly db: Db) {}

  async record(rec: TickRecord): Promise<void> {
    await this.db.insert(tickReports).values({
      ranAt: rec.ranAt,
      durationMs: rec.durationMs,
      ok: rec.ok,
      error: rec.error,
      extracted: rec.extracted,
      storiesUpserted: rec.storiesUpserted,
      signalsObserved: rec.signalsObserved,
      skipped: rec.skipped as SourceId[],
      failed: rec.failed as SourceFailure[],
      signalsSkipped: rec.signalsSkipped as SourceId[],
      signalsFailed: rec.signalsFailed as SourceFailure[],
    });
  }

  async recent(limit: number): Promise<TickRecord[]> {
    const rows = await this.db
      .select()
      .from(tickReports)
      .orderBy(desc(tickReports.ranAt))
      .limit(limit);
    return rows.map(toRecord);
  }

  async pruneToRecent(keep: number): Promise<number> {
    if (keep <= 0) return 0;
    // Ids of the most recent `keep` rows; delete everything else.
    const survivors = await this.db
      .select({ id: tickReports.id })
      .from(tickReports)
      .orderBy(desc(tickReports.ranAt))
      .limit(keep);
    if (survivors.length < keep) return 0; // nothing to prune yet
    const keepIds = survivors.map((r) => r.id);
    const stale = await this.db
      .select({ id: tickReports.id })
      .from(tickReports)
      .where(notInArray(tickReports.id, keepIds));
    if (stale.length === 0) return 0;
    await this.db.delete(tickReports).where(notInArray(tickReports.id, keepIds));
    return stale.length;
  }
}

/** Map a tick_reports row to a domain TickRecord (matches the other repos' toDomain pattern). */
function toRecord(row: typeof tickReports.$inferSelect): TickRecord {
  return {
    ranAt: row.ranAt,
    durationMs: row.durationMs,
    ok: row.ok,
    error: row.error,
    extracted: row.extracted,
    storiesUpserted: row.storiesUpserted,
    signalsObserved: row.signalsObserved,
    skipped: row.skipped,
    failed: row.failed,
    signalsSkipped: row.signalsSkipped,
    signalsFailed: row.signalsFailed,
  };
}
