import { utcDay } from '../db/usage-repo.js';

/**
 * The model tiers the transports bill against (ADR-0006/0012). `embed` and
 * `tts` bill in provider-specific units (total tokens, characters
 * respectively) but share the same daily-counter accounting (Task 15).
 */
export type TokenTier = 'cheap' | 'deep' | 'embed' | 'tts';

/** One completion's token usage, as reported by the provider transport. */
export interface TokenUsageEvent {
  readonly tier: TokenTier;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * The persistence slice the ledger needs — a durable "add N to (key, day)"
 * counter. `DrizzleUsageRepo.add` satisfies it; tests inject a fake.
 */
export interface TokenCounterStore {
  add(key: string, day: string, amount: number): Promise<void>;
}

/** The durable usage-counter key for one tier's daily token total. */
export function tokenUsageKey(tier: TokenTier): string {
  return `global:tokens:${tier}`;
}

export interface TokenLedgerDeps {
  /** Time source (epoch ms) — determines the UTC day bucket. */
  readonly now: () => number;
  /** Optional durable counter; omitted ⇒ in-memory only. */
  readonly store?: TokenCounterStore;
  /** Persist failures are swallowed (accounting must never break a completion);
   * they surface here. Default: silent. */
  readonly onError?: (err: unknown) => void;
}

/** Per-tier running totals for the current UTC day. */
export interface TierTokenTotals {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface DailyTokenTotals {
  readonly day: string;
  readonly cheap: TierTokenTotals;
  readonly deep: TierTokenTotals;
  readonly embed: TierTokenTotals;
  readonly tts: TierTokenTotals;
  readonly totalTokens: number;
}

/** A fresh zeroed totals bucket per tier — shared by construction and day-roll. */
function zeroTotals(): Record<TokenTier, { prompt: number; completion: number }> {
  return {
    cheap: { prompt: 0, completion: 0 },
    deep: { prompt: 0, completion: 0 },
    embed: { prompt: 0, completion: 0 },
    tts: { prompt: 0, completion: 0 },
  };
}

/**
 * Token usage accounting. Accumulates per-tier daily totals in memory (fast,
 * synchronous reads for the stats surface) AND fires a durable per-day counter
 * write (`global:tokens:<tier>`, same `(key, day)` scheme as the podcast quota,
 * ADR-0022/0052) so totals survive a restart. Recording is fire-and-forget:
 * a failed persist never fails — or slows — the completion that reported it.
 */
export class TokenLedger {
  private day: string;
  private totals: Record<TokenTier, { prompt: number; completion: number }> = zeroTotals();

  constructor(private readonly deps: TokenLedgerDeps) {
    this.day = utcDay(deps.now());
  }

  /** Roll the in-memory bucket when the UTC day changes (durable rows key by day already). */
  private rollDay(): void {
    const today = utcDay(this.deps.now());
    if (today === this.day) return;
    this.day = today;
    this.totals = zeroTotals();
  }

  record(u: TokenUsageEvent): void {
    this.rollDay();
    const t = this.totals[u.tier];
    t.prompt += u.promptTokens;
    t.completion += u.completionTokens;

    const amount = u.promptTokens + u.completionTokens;
    if (this.deps.store && amount > 0) {
      void this.deps.store
        .add(tokenUsageKey(u.tier), this.day, amount)
        .catch((err) => this.deps.onError?.(err));
    }
  }

  /** Today's in-memory totals (since process start or the last UTC midnight). */
  today(): DailyTokenTotals {
    this.rollDay();
    const tier = (t: { prompt: number; completion: number }): TierTokenTotals => ({
      promptTokens: t.prompt,
      completionTokens: t.completion,
      totalTokens: t.prompt + t.completion,
    });
    const cheap = tier(this.totals.cheap);
    const deep = tier(this.totals.deep);
    const embed = tier(this.totals.embed);
    const tts = tier(this.totals.tts);
    return {
      day: this.day,
      cheap,
      deep,
      embed,
      tts,
      totalTokens: cheap.totalTokens + deep.totalTokens + embed.totalTokens + tts.totalTokens,
    };
  }
}
