import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleUsageRepo } from '../../src/db/usage-repo.js';

describe('UsageRepo', () => {
  it('increments a (key, day) counter and returns the new count', async () => {
    const repo = new DrizzleUsageRepo(await createTestDb());
    expect(await repo.incrementAndGet('chat:42:podcast', '2026-06-17')).toBe(1);
    expect(await repo.incrementAndGet('chat:42:podcast', '2026-06-17')).toBe(2);
    expect(await repo.incrementAndGet('chat:42:podcast', '2026-06-17')).toBe(3);
  });

  it('isolates counters by key and by day', async () => {
    const repo = new DrizzleUsageRepo(await createTestDb());
    await repo.incrementAndGet('chat:1:podcast', '2026-06-17');
    await repo.incrementAndGet('chat:1:podcast', '2026-06-17');

    expect(await repo.incrementAndGet('chat:2:podcast', '2026-06-17')).toBe(1); // other chat
    expect(await repo.incrementAndGet('chat:1:podcast', '2026-06-18')).toBe(1); // next day resets
    expect(await repo.incrementAndGet('global:podcast', '2026-06-17')).toBe(1); // global counter
  });
});
