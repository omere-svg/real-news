import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAITransport } from '../../src/llm/openai-transport.js';

/** A fake OpenAI client capturing the create() args and returning canned content. */
function fakeClient(content: string | null): { client: OpenAI; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }] });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

const deps = (client: OpenAI) => ({ cheapModel: 'gpt-4o-mini', deepModel: 'gpt-4o', client });

describe('OpenAITransport', () => {
  it('routes the cheap tier to the cheap model and the deep tier to the deep model', async () => {
    const { client, create } = fakeClient('hi');
    const t = new OpenAITransport(deps(client));
    await t.complete('p', { tier: 'cheap', maxTokens: 10 });
    expect(create.mock.calls[0]?.[0].model).toBe('gpt-4o-mini');
    await t.complete('p', { tier: 'deep', maxTokens: 10 });
    expect(create.mock.calls[1]?.[0].model).toBe('gpt-4o'); // a regression here silently bills deep-tier
  });

  it('passes temperature through when set, omits it otherwise', async () => {
    const { client, create } = fakeClient('hi');
    const t = new OpenAITransport(deps(client));
    await t.complete('p', { tier: 'cheap', maxTokens: 10, temperature: 0.3 });
    expect(create.mock.calls[0]?.[0].temperature).toBe(0.3);
    await t.complete('p', { tier: 'cheap', maxTokens: 10 });
    expect('temperature' in create.mock.calls[1]?.[0]).toBe(false);
  });

  it('completeJson parses the JSON reply and requests a json_object', async () => {
    const { client, create } = fakeClient('{"topic":"AI"}');
    const t = new OpenAITransport(deps(client));
    expect(await t.completeJson('p', { tier: 'cheap', maxTokens: 10 })).toEqual({ topic: 'AI' });
    expect(create.mock.calls[0]?.[0].response_format).toEqual({ type: 'json_object' });
  });

  it('completeJson throws on an empty response (never returns undefined)', async () => {
    const { client } = fakeClient(null);
    const t = new OpenAITransport(deps(client));
    await expect(t.completeJson('p', { tier: 'cheap', maxTokens: 10 })).rejects.toThrow(/empty/i);
  });

  it('complete returns trimmed text', async () => {
    const { client } = fakeClient('  spaced  ');
    const t = new OpenAITransport(deps(client));
    expect(await t.complete('p', { tier: 'deep', maxTokens: 10 })).toBe('spaced');
  });
});
