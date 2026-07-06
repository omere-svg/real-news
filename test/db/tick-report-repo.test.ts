import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleTickReportRepo, type TickRecord } from '../../src/db/tick-report-repo.js';

function record(over: Partial<TickRecord> = {}): TickRecord {
  return {
    ranAt: 1000,
    durationMs: 250,
    ok: true,
    error: null,
    extracted: 40,
    storiesUpserted: 12,
    signalsObserved: 8,
    skipped: [],
    failed: [],
    signalsSkipped: [],
    signalsFailed: [],
    ...over,
  };
}

describe('TickReportRepo (ADR-0033)', () => {
  it('records a tick and reads it back with its source lists', async () => {
    const repo = new DrizzleTickReportRepo(await createTestDb());
    await repo.record(
      record({ skipped: ['gdelt'], failed: [{ source: 'arxiv', error: 'timeout' }] }),
    );

    const [r] = await repo.recent(10);
    expect(r?.extracted).toBe(40);
    expect(r?.storiesUpserted).toBe(12);
    expect(r?.skipped).toEqual(['gdelt']);
    expect(r?.failed).toEqual([{ source: 'arxiv', error: 'timeout' }]);
    expect(r?.ok).toBe(true);
  });

  it('records a failed tick (ok=false with an error message)', async () => {
    const repo = new DrizzleTickReportRepo(await createTestDb());
    await repo.record(record({ ok: false, error: 'boom', extracted: 0, storiesUpserted: 0 }));

    const [r] = await repo.recent(10);
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe('boom');
  });

  it('returns the most recent first, bounded by limit', async () => {
    const repo = new DrizzleTickReportRepo(await createTestDb());
    await repo.record(record({ ranAt: 100 }));
    await repo.record(record({ ranAt: 300 }));
    await repo.record(record({ ranAt: 200 }));

    const recent = await repo.recent(2);
    expect(recent.map((r) => r.ranAt)).toEqual([300, 200]); // newest first, capped at 2
  });

  it('prunes to the most recent N (ADR-0042)', async () => {
    const repo = new DrizzleTickReportRepo(await createTestDb());
    for (const ranAt of [100, 200, 300, 400, 500]) await repo.record(record({ ranAt }));

    const removed = await repo.pruneToRecent(2);
    expect(removed).toBe(3);
    const kept = await repo.recent(10);
    expect(kept.map((r) => r.ranAt)).toEqual([500, 400]);
  });

  it('does not prune before the keep threshold is reached (ADR-0042)', async () => {
    const repo = new DrizzleTickReportRepo(await createTestDb());
    await repo.record(record({ ranAt: 100 }));
    expect(await repo.pruneToRecent(5)).toBe(0);
    expect(await repo.recent(10)).toHaveLength(1);
  });
});
