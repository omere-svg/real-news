import { describe, expect, it } from 'vitest';
import { SpendGuard, spendUsdOf, type TokenPricing } from '../../src/llm/spend-guard.js';
import type { DailyTokenTotals } from '../../src/llm/token-ledger.js';

const PRICING: TokenPricing = { cheap: 0.5, deep: 10, embed: 0.02 };

const tier = (total: number) => ({ promptTokens: total, completionTokens: 0, totalTokens: total });

function totals(day: string, over: Partial<DailyTokenTotals> = {}): DailyTokenTotals {
  return {
    day,
    cheap: tier(0),
    deep: tier(0),
    embed: tier(0),
    tts: tier(0),
    totalTokens: 0,
    ttsCharacters: 0,
    ...over,
  };
}

/** A ledger stub whose `today()` returns a fixed snapshot (swappable per test). */
function ledgerReturning(snapshot: () => DailyTokenTotals) {
  return { today: snapshot };
}

describe('SpendGuard (ADR-0062)', () => {
  it('adds the boot baseline to this session\'s live spend', () => {
    // 2M deep tokens this session = $20; baseline $30 ⇒ $50 total.
    const guard = new SpendGuard(
      ledgerReturning(() => totals('2026-07-07', { deep: tier(2_000_000) })),
      PRICING,
      1000,
      30,
      '2026-07-07',
    );
    expect(guard.spentUsd()).toBeCloseTo(50, 5);
    expect(guard.isExhausted()).toBe(false);
  });

  it('is exhausted once baseline + session reaches the cap', () => {
    const guard = new SpendGuard(
      ledgerReturning(() => totals('2026-07-07', { deep: tier(80_000_000) })), // $800
      PRICING,
      1000,
      300, // baseline $300 ⇒ $1100 total > $1000
      '2026-07-07',
    );
    expect(guard.spentUsd()).toBeCloseTo(1100, 5);
    expect(guard.isExhausted()).toBe(true);
  });

  it('drops the stale baseline on a UTC day roll so the cap tracks calendar spend', () => {
    let day = '2026-07-07';
    const guard = new SpendGuard(
      ledgerReturning(() => totals(day, { deep: tier(1_000_000) })), // $10 this session
      PRICING,
      1000,
      995, // near the cap yesterday
      '2026-07-07',
    );
    expect(guard.isExhausted()).toBe(true); // 995 + 10 = 1005 > 1000

    day = '2026-07-08'; // midnight rolls; ledger.today() now reports the new day
    expect(guard.spentUsd()).toBeCloseTo(10, 5); // baseline dropped, only session counts
    expect(guard.isExhausted()).toBe(false);
  });

  it('a zero/negative cap disables the guard entirely', () => {
    const guard = new SpendGuard(
      ledgerReturning(() => totals('2026-07-07', { deep: tier(999_000_000) })),
      PRICING,
      0,
      1_000_000,
      '2026-07-07',
    );
    expect(guard.isExhausted()).toBe(false);
  });

  it('spendUsdOf prices each token-denominated tier (TTS excluded)', () => {
    const usd = spendUsdOf(
      { cheap: tier(1_000_000), deep: tier(1_000_000), embed: tier(1_000_000) },
      PRICING,
    );
    expect(usd).toBeCloseTo(0.5 + 10 + 0.02, 5);
  });
});
