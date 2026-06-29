import { desc } from 'drizzle-orm';
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
  /** Error message when `ok` is false, else null. */
  readonly error: string | null;
}

/** The observability log store (ADR-0033). */
export interface TickReportRepo {
  record(rec: TickRecord): Promise<void>;
  /** The most recent records, newest first. */
  recent(limit: number): Promise<TickRecord[]>;
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
    return rows.map((r) => ({
      ranAt: r.ranAt,
      durationMs: r.durationMs,
      ok: r.ok,
      error: r.error,
      extracted: r.extracted,
      storiesUpserted: r.storiesUpserted,
      signalsObserved: r.signalsObserved,
      skipped: r.skipped,
      failed: r.failed,
      signalsSkipped: r.signalsSkipped,
      signalsFailed: r.signalsFailed,
    }));
  }
}
