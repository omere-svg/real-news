import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { agentPolicy } from './schema.js';

/**
 * The persisted output of the reflection→action loop (ADR-0053): bounded
 * parameter overrides a screened reflection imposed. Single row (id = 1), read
 * at the top of every tick — so an adaptation survives restarts and deploys
 * instead of being forgotten with the process.
 */
/** The bounded parameter overrides a screened reflection may impose (ADR-0053/0061). */
export interface AgentPolicy {
  /** Override for reasoner.deepAnalysisTopN; null defers to config. */
  readonly deepAnalysisTopN: number | null;
  /** Override for dedup.confirmConcurrency (ADR-0061); null defers to config. */
  readonly confirmConcurrency: number | null;
  /** Override for dedup.candidateThreshold (ADR-0061); null defers to config. */
  readonly candidateThreshold: number | null;
  /** Why the current policy is what it is. */
  readonly reason: string | null;
  readonly updatedAt: number;
}

/** The writable slice of a policy — the three overrides plus the reason. */
export type AgentPolicyPatch = Pick<
  AgentPolicy,
  'deepAnalysisTopN' | 'confirmConcurrency' | 'candidateThreshold' | 'reason'
>;

export interface AgentPolicyRepo {
  get(): Promise<AgentPolicy | null>;
  set(policy: AgentPolicyPatch, now: number): Promise<void>;
}

export class DrizzleAgentPolicyRepo implements AgentPolicyRepo {
  constructor(private readonly db: Db) {}

  async get(): Promise<AgentPolicy | null> {
    const rows = await this.db.select().from(agentPolicy).where(eq(agentPolicy.id, 1));
    const row = rows[0];
    if (!row) return null;
    return {
      deepAnalysisTopN: row.deepAnalysisTopN,
      confirmConcurrency: row.confirmConcurrency,
      candidateThreshold: row.candidateThreshold,
      reason: row.reason,
      updatedAt: row.updatedAt,
    };
  }

  async set(policy: AgentPolicyPatch, now: number): Promise<void> {
    await this.db
      .insert(agentPolicy)
      .values({ id: 1, ...policy, updatedAt: now })
      .onConflictDoUpdate({
        target: agentPolicy.id,
        set: { ...policy, updatedAt: now },
      });
  }
}
