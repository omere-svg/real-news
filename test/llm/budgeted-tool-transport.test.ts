import { describe, expect, it, vi } from 'vitest';
import { BudgetedToolTransport } from '../../src/llm/budgeted-tool-transport.js';
import type { ToolCapableTransport, ToolCompletion } from '../../src/llm/chat-transport.js';

const reply: ToolCompletion = { text: 'ok', toolCalls: [] };

function fakeDelegate(): ToolCapableTransport & { calls: number } {
  return {
    calls: 0,
    async completeWithTools() {
      this.calls += 1;
      return reply;
    },
  };
}

const opts = { tier: 'cheap', maxTokens: 100 } as const;

describe('BudgetedToolTransport (ADR-0062 — cap applies to the chat agent too)', () => {
  it('delegates normally while the budget is not exhausted', async () => {
    const delegate = fakeDelegate();
    const t = new BudgetedToolTransport(delegate, { isExhausted: () => false });

    expect(await t.completeWithTools([], [], opts)).toEqual(reply);
    expect(delegate.calls).toBe(1);
  });

  it('short-circuits without touching the provider once the cap is exhausted', async () => {
    const delegate = fakeDelegate();
    const onExhausted = vi.fn();
    const t = new BudgetedToolTransport(delegate, { isExhausted: () => true }, onExhausted);

    // Throwing is the contract: the bot degrades to its fixed cache-only path.
    await expect(t.completeWithTools([], [], opts)).rejects.toThrow(/daily spend cap/);
    expect(delegate.calls).toBe(0); // no network call
    expect(onExhausted).toHaveBeenCalledOnce();
  });
});
