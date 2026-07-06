import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleSignalObservationRepo } from '../../src/db/signal-observation-repo.js';
import type { SignalObservation } from '../../src/domain/types.js';

function obs(over: Partial<SignalObservation> = {}): SignalObservation {
  return {
    source: 'coingecko',
    topic: 'Business',
    key: 'coingecko:bitcoin:20260706',
    value: 5,
    observedAt: 1000,
    ...over,
  };
}

describe('SignalObservationRepo (ADR-0044)', () => {
  it('records observations and returns the latest prior value per key', async () => {
    const repo = new DrizzleSignalObservationRepo(await createTestDb());
    await repo.record([obs({ value: 3, observedAt: 1000 })]);
    await repo.record([obs({ value: 8, observedAt: 2000 })]); // newer

    const priors = await repo.priorValues(['coingecko:bitcoin:20260706', 'missing']);
    expect(priors.get('coingecko:bitcoin:20260706')).toBe(8); // most recent wins
    expect(priors.has('missing')).toBe(false);
  });

  it('ignores empty inputs gracefully', async () => {
    const repo = new DrizzleSignalObservationRepo(await createTestDb());
    await repo.record([]);
    expect((await repo.priorValues([])).size).toBe(0);
  });

  it('prunes observations older than a cutoff', async () => {
    const repo = new DrizzleSignalObservationRepo(await createTestDb());
    await repo.record([
      obs({ key: 'a', observedAt: 1000 }),
      obs({ key: 'b', observedAt: 5000 }),
    ]);

    const removed = await repo.pruneOlderThan(3000);
    expect(removed).toBe(1);
    const priors = await repo.priorValues(['a', 'b']);
    expect(priors.has('a')).toBe(false); // pruned
    expect(priors.has('b')).toBe(true); // kept
  });
});
