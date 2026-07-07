import { describe, expect, it, vi } from 'vitest';
import { TokenLedger, tokenUsageKey } from '../../src/llm/token-ledger.js';

const DAY1 = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15T12:00Z
const DAY2 = Date.UTC(2026, 0, 16, 0, 5, 0); // just past UTC midnight

describe('TokenLedger', () => {
  it('accumulates per-tier daily totals in memory', () => {
    const ledger = new TokenLedger({ now: () => DAY1 });
    ledger.record({ tier: 'cheap', promptTokens: 100, completionTokens: 20 });
    ledger.record({ tier: 'cheap', promptTokens: 50, completionTokens: 10 });
    ledger.record({ tier: 'deep', promptTokens: 1000, completionTokens: 200 });

    expect(ledger.today()).toEqual({
      day: '2026-01-15',
      cheap: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
      deep: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
      embed: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      tts: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      totalTokens: 1380, // cheap + deep + embed only — no tts in this event mix
      ttsCharacters: 0,
    });
  });

  it('persists a durable per-tier counter keyed by UTC day', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const ledger = new TokenLedger({ now: () => DAY1, store: { add } });
    ledger.record({ tier: 'deep', promptTokens: 300, completionTokens: 40 });

    expect(add).toHaveBeenCalledWith(tokenUsageKey('deep'), '2026-01-15', 340);
  });

  it('rolls the in-memory bucket at UTC midnight', () => {
    let now = DAY1;
    const ledger = new TokenLedger({ now: () => now });
    ledger.record({ tier: 'cheap', promptTokens: 100, completionTokens: 0 });

    now = DAY2;
    ledger.record({ tier: 'cheap', promptTokens: 7, completionTokens: 3 });
    expect(ledger.today()).toMatchObject({
      day: '2026-01-16',
      cheap: { totalTokens: 10 }, // yesterday's 100 is not today's total
    });
  });

  it('swallows a persist failure (reported to onError) — accounting never breaks a completion', async () => {
    const onError = vi.fn();
    const ledger = new TokenLedger({
      now: () => DAY1,
      store: { add: () => Promise.reject(new Error('db down')) },
      onError,
    });
    expect(() =>
      ledger.record({ tier: 'cheap', promptTokens: 1, completionTokens: 1 }),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r)); // let the rejected persist settle
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(ledger.today().totalTokens).toBe(2); // in-memory total still counted
  });

  it('skips the durable write for a zero-token event', () => {
    const add = vi.fn();
    const ledger = new TokenLedger({ now: () => DAY1, store: { add } });
    ledger.record({ tier: 'cheap', promptTokens: 0, completionTokens: 0 });
    expect(add).not.toHaveBeenCalled();
  });

  it('accumulates embed and tts tiers alongside cheap/deep', () => {
    const ledger = new TokenLedger({ now: () => DAY1 });
    ledger.record({ tier: 'embed', promptTokens: 42, completionTokens: 0 });
    ledger.record({ tier: 'tts', promptTokens: 500, completionTokens: 0 });

    expect(ledger.today()).toEqual({
      day: '2026-01-15',
      cheap: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      deep: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      embed: { promptTokens: 42, completionTokens: 0, totalTokens: 42 },
      tts: { promptTokens: 500, completionTokens: 0, totalTokens: 500 },
      totalTokens: 42, // embed only — tts characters are not tokens
      ttsCharacters: 500,
    });
  });

  it('excludes tts from totalTokens even when it dwarfs the token tiers', () => {
    const ledger = new TokenLedger({ now: () => DAY1 });
    ledger.record({ tier: 'cheap', promptTokens: 10, completionTokens: 5 });
    ledger.record({ tier: 'tts', promptTokens: 100_000, completionTokens: 0 });

    const totals = ledger.today();
    expect(totals.totalTokens).toBe(15);
    expect(totals.ttsCharacters).toBe(100_000);
  });

  it('persists a durable per-tier counter for embed and tts', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const ledger = new TokenLedger({ now: () => DAY1, store: { add } });
    ledger.record({ tier: 'embed', promptTokens: 42, completionTokens: 0 });
    ledger.record({ tier: 'tts', promptTokens: 500, completionTokens: 0 });

    expect(add).toHaveBeenCalledWith(tokenUsageKey('embed'), '2026-01-15', 42);
    expect(add).toHaveBeenCalledWith(tokenUsageKey('tts'), '2026-01-15', 500);
  });
});
