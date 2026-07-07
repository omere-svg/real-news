import { count, desc, inArray, lt, min } from 'drizzle-orm';
import type { Db } from './client.js';
import { signalObservations } from './schema.js';
import type { SignalObservation } from '../domain/types.js';

/**
 * The Signal-history store (ADR-0044). Persists each tick's numeric observations
 * so scoring can reward a **rising** series (a trend) over a flat one, and prunes
 * to a bounded recent window so history never grows without bound (ADR-0042).
 */
/** Read-only accumulation counters for `/api/stats` — how much Signal history
 * the system has built up (ADR-0044). */
export interface SignalObservationStats {
  /** Total persisted observations across all series. */
  readonly observations: number;
  /** Epoch ms of the oldest stored observation; null when history is empty. */
  readonly oldestObservedAt: number | null;
}

/** One series' latest reading + its prior, for the chat agent's trends tool (ADR-0053). */
export interface SignalTrend {
  readonly key: string;
  readonly value: number;
  readonly prior: number | null;
  readonly observedAt: number;
}

export interface SignalObservationRepo {
  /** Append this tick's observations. */
  record(observations: readonly SignalObservation[]): Promise<void>;
  /**
   * The most recent stored value for each of `keys` (across all history). Call
   * this BEFORE recording the current tick, so it returns each series' *prior*
   * reading — the baseline a rise is measured against. Missing keys are absent.
   */
  priorValues(keys: readonly string[]): Promise<Map<string, number>>;
  /**
   * The latest reading (+ its prior, when one exists) for the most recently
   * observed `maxKeys` series — the chat agent's get_signal_trends tool
   * (ADR-0053). Most recent first.
   */
  latestTrends(maxKeys: number): Promise<SignalTrend[]>;
  /** Delete observations older than `beforeMs`. Returns the number removed. */
  pruneOlderThan(beforeMs: number): Promise<number>;
  /** Cheap COUNT/MIN accumulation stats for the public `/api/stats` endpoint. */
  stats(): Promise<SignalObservationStats>;
}

export class DrizzleSignalObservationRepo implements SignalObservationRepo {
  constructor(private readonly db: Db) {}

  async record(observations: readonly SignalObservation[]): Promise<void> {
    if (observations.length === 0) return;
    await this.db.insert(signalObservations).values(
      observations.map((o) => ({
        source: o.source,
        key: o.key,
        topic: o.topic,
        value: o.value,
        observedAt: o.observedAt,
      })),
    );
  }

  async priorValues(keys: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (keys.length === 0) return out;

    // Newest-first; keep the first (latest) value seen per key.
    const rows = await this.db
      .select({
        key: signalObservations.key,
        value: signalObservations.value,
        observedAt: signalObservations.observedAt,
      })
      .from(signalObservations)
      .where(inArray(signalObservations.key, [...new Set(keys)]))
      .orderBy(desc(signalObservations.observedAt));

    for (const r of rows) {
      if (!out.has(r.key)) out.set(r.key, r.value);
    }
    return out;
  }

  async latestTrends(maxKeys: number): Promise<SignalTrend[]> {
    if (maxKeys <= 0) return [];
    // One bounded read, grouped in memory: history is pruned to a recent
    // window (ADR-0042), and each tick writes ~a few dozen series.
    const rows = await this.db
      .select({
        key: signalObservations.key,
        value: signalObservations.value,
        observedAt: signalObservations.observedAt,
      })
      .from(signalObservations)
      .orderBy(desc(signalObservations.observedAt))
      .limit(600);

    const latest = new Map<string, { value: number; prior: number | null; observedAt: number }>();
    for (const r of rows) {
      const seen = latest.get(r.key);
      if (!seen) {
        latest.set(r.key, { value: r.value, prior: null, observedAt: r.observedAt });
      } else if (seen.prior === null) {
        seen.prior = r.value; // the next-most-recent reading of this series
      }
    }
    return [...latest.entries()]
      .slice(0, maxKeys)
      .map(([key, t]) => ({ key, value: t.value, prior: t.prior, observedAt: t.observedAt }));
  }

  async stats(): Promise<SignalObservationStats> {
    const [row] = await this.db
      .select({ n: count(), oldest: min(signalObservations.observedAt) })
      .from(signalObservations);
    return { observations: row?.n ?? 0, oldestObservedAt: row?.oldest ?? null };
  }

  async pruneOlderThan(beforeMs: number): Promise<number> {
    const stale = await this.db
      .select({ id: signalObservations.id })
      .from(signalObservations)
      .where(lt(signalObservations.observedAt, beforeMs));
    if (stale.length === 0) return 0;
    await this.db
      .delete(signalObservations)
      .where(lt(signalObservations.observedAt, beforeMs));
    return stale.length;
  }
}
