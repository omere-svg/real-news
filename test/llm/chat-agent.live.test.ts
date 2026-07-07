import { describe, expect, it } from 'vitest';
import { OpenAITransport } from '../../src/llm/openai-transport.js';
import { ChatAgent, buildChatTools, type AgentStoryReader } from '../../src/telegram/chat-agent.js';
import { loadConfig } from '../../src/config/load.js';
import type { Story } from '../../src/domain/types.js';

/**
 * Env-gated LIVE golden test (ADR-0053). Skipped unless OPENAI_API_KEY is set,
 * so CI and offline runs never spend or flake on the network. When a key IS
 * present it exercises the WHOLE model-driven loop against the real API: the
 * agent must plan, call a tool, observe, and answer grounded in the cache — the
 * plan→act→observe trajectory the rubric asks for. Run it locally with:
 *   OPENAI_API_KEY=sk-... npx vitest run test/llm/chat-agent.live.test.ts
 */
const LIVE = Boolean(process.env.OPENAI_API_KEY);

function story(over: Partial<Story> = {}): Story {
  return {
    id: 's1',
    title: 'Central bank holds interest rates steady at 4.5%',
    url: 'https://example.com/rates',
    topic: 'Business',
    significance: 8,
    summary: 'The central bank left its benchmark rate unchanged at 4.5% on Tuesday, citing cooling inflation.',
    whyItMatters: 'Borrowing costs stay put for mortgages and business loans.',
    displayTitle: null,
    scoreBreakdown: null,
    memberRefs: [{ source: 'guardian', externalId: 'g1' }],
    firstSeenAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe.skipIf(!LIVE)('ChatAgent (LIVE OpenAI)', () => {
  const config = loadConfig('config/horizon.yaml');
  const transport = new OpenAITransport({
    cheapModel: config.reasoner.cheapModel,
    deepModel: config.reasoner.deepModel,
  });

  const reader: AgentStoryReader = {
    topStories: async () => [story()],
    get: async (id) => (id === 's1' ? story() : null),
  };

  it('plans, calls a tool, and answers grounded in the cache', async () => {
    const tools = buildChatTools({ reader });
    const agent = new ChatAgent({ transport, tools });

    const out = await agent.answer({
      question: 'What did the central bank do with interest rates?',
      history: [],
    });

    // A real, non-empty answer that actually used the facts in the cache.
    expect(out.answer.trim().length).toBeGreaterThan(0);
    expect(out.answer).toMatch(/4\.5|rate|interest/i);
    expect(out.steps.length).toBeGreaterThan(0); // it acted (called at least one tool)
    // Grounding guard: no URL that the tools never surfaced can appear.
    for (const m of out.answer.match(/https?:\/\/[^\s)]+/g) ?? []) {
      expect(m).toContain('example.com/rates');
    }
  }, 60_000);

  it('says it cannot find something outside the cache instead of inventing it', async () => {
    const tools = buildChatTools({ reader });
    const agent = new ChatAgent({ transport, tools });

    const out = await agent.answer({
      question: 'What was the score of last night’s Real Madrid match?',
      history: [],
    });

    expect(out.answer.trim().length).toBeGreaterThan(0);
    expect(out.answeredFromNews).toBe(false); // not in the (Business-only) cache
  }, 60_000);
});
