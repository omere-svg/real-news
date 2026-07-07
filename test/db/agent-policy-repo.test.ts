import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { DrizzleAgentPolicyRepo } from '../../src/db/agent-policy-repo.js';

describe('DrizzleAgentPolicyRepo (ADR-0053)', () => {
  it('returns null before any policy has been set', async () => {
    const repo = new DrizzleAgentPolicyRepo(await createTestDb());
    expect(await repo.get()).toBeNull();
  });

  it('persists and overwrites the single policy row', async () => {
    const repo = new DrizzleAgentPolicyRepo(await createTestDb());

    await repo.set({ deepAnalysisTopN: 6, reason: 'slow ticks' }, 1000);
    expect(await repo.get()).toEqual({
      deepAnalysisTopN: 6,
      reason: 'slow ticks',
      updatedAt: 1000,
    });

    await repo.set({ deepAnalysisTopN: null, reason: null }, 2000);
    expect(await repo.get()).toEqual({
      deepAnalysisTopN: null,
      reason: null,
      updatedAt: 2000,
    });
  });
});
