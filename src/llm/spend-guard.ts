import type { DailyTokenTotals, TokenLedger } from './token-ledger.js';

/**
 * Per-tier USD price per 1,000,000 tokens (ADR-0062). Estimates, configurable —
 * the guard is a coarse daily backstop, not an invoice, so approximate prices
 * are fine. TTS bills in characters and is excluded from the token spend model.
 */
export interface TokenPricing {
  readonly cheap: number;
  readonly deep: number;
  readonly embed: number;
}

/** The read the resilient LLM client needs to decide whether to skip a call. */
export interface SpendBudget {
  /** True once today's estimated spend has reached the configured ceiling. */
  isExhausted(): boolean;
}

const usdOf = (totals: DailyTokenTotals, pricing: TokenPricing): number =>
  (totals.cheap.totalTokens / 1_000_000) * pricing.cheap +
  (totals.deep.totalTokens / 1_000_000) * pricing.deep +
  (totals.embed.totalTokens / 1_000_000) * pricing.embed;

/**
 * A durable, restart-safe daily spend ceiling for model usage (ADR-0062). It is
 * a HARD BACKSTOP, deliberately set very high in config so normal operation
 * never touches it — its job is to stop a runaway (a retry storm, a prompt-loop
 * bug, an abuse spike) from running an unbounded bill overnight.
 *
 * Restart-safety without double-counting: the persisted per-tier token counters
 * (`global:tokens:<tier>`, written by the TokenLedger) already record the whole
 * UTC day's usage. At boot we read that day's total as an immutable `baseline`;
 * from then on this session's own tokens are read live from the in-memory
 * ledger. Total-so-far = baseline + this-session — the ledger keeps writing the
 * persisted counters, but we never re-read them, so a token is counted once. On
 * a UTC day roll the ledger's `today()` resets to the new day and we drop the
 * (now-stale) baseline, so the ceiling tracks calendar spend, not process
 * lifetime.
 */
export class SpendGuard implements SpendBudget {
  private baselineDay: string;

  constructor(
    private readonly ledger: Pick<TokenLedger, 'today'>,
    private readonly pricing: TokenPricing,
    /** USD/day ceiling; <= 0 disables the guard entirely (never exhausted). */
    private readonly dailyUsdCap: number,
    /** Today's already-spent USD, read from the persisted counters at boot. */
    private baselineUsd: number,
    baselineDay: string,
  ) {
    this.baselineDay = baselineDay;
  }

  /** Estimated USD spent so far on the current UTC day (baseline + this session). */
  spentUsd(): number {
    const today = this.ledger.today();
    // A new UTC day: the persisted baseline was for yesterday, and the ledger's
    // own totals already rolled to zero for the new day — so drop the baseline.
    if (today.day !== this.baselineDay) {
      this.baselineDay = today.day;
      this.baselineUsd = 0;
    }
    return this.baselineUsd + usdOf(today, this.pricing);
  }

  isExhausted(): boolean {
    if (this.dailyUsdCap <= 0) return false;
    return this.spentUsd() >= this.dailyUsdCap;
  }
}

/**
 * The USD value of an arbitrary per-tier token snapshot (used to seed the boot
 * baseline from the persisted counters). Exported so main.ts and tests share
 * one pricing formula.
 */
export function spendUsdOf(
  totals: Pick<DailyTokenTotals, 'cheap' | 'deep' | 'embed'>,
  pricing: TokenPricing,
): number {
  return (
    (totals.cheap.totalTokens / 1_000_000) * pricing.cheap +
    (totals.deep.totalTokens / 1_000_000) * pricing.deep +
    (totals.embed.totalTokens / 1_000_000) * pricing.embed
  );
}
