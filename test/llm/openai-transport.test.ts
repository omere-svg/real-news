import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAITransport } from '../../src/llm/openai-transport.js';

/** A fake OpenAI client capturing the create() args and returning canned content. */
function fakeClient(
  content: string | null,
  usage?: { prompt_tokens: number; completion_tokens: number },
): { client: OpenAI; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }], usage });
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

  it('reports token usage per completion via onUsage, tagged with the billed tier', async () => {
    const { client } = fakeClient('{"ok":true}', { prompt_tokens: 120, completion_tokens: 30 });
    const onUsage = vi.fn();
    const t = new OpenAITransport({ ...deps(client), onUsage });

    await t.complete('p', { tier: 'cheap', maxTokens: 10 });
    await t.completeJson('p', { tier: 'deep', maxTokens: 10 });
    await t.completeWithTools([{ role: 'user', content: 'q' }], [], { tier: 'cheap', maxTokens: 10 });

    expect(onUsage.mock.calls.map(([u]) => u)).toEqual([
      { tier: 'cheap', promptTokens: 120, completionTokens: 30 },
      { tier: 'deep', promptTokens: 120, completionTokens: 30 },
      { tier: 'cheap', promptTokens: 120, completionTokens: 30 },
    ]);
  });

  it('stays silent when the response carries no usage or no onUsage is wired', async () => {
    const onUsage = vi.fn();
    const noUsage = fakeClient('hi'); // response without a usage block
    await new OpenAITransport({ ...deps(noUsage.client), onUsage }).complete('p', {
      tier: 'cheap',
      maxTokens: 10,
    });
    expect(onUsage).not.toHaveBeenCalled();

    const unwired = fakeClient('hi', { prompt_tokens: 1, completion_tokens: 1 });
    await expect(
      new OpenAITransport(deps(unwired.client)).complete('p', { tier: 'cheap', maxTokens: 10 }),
    ).resolves.toBe('hi'); // no onUsage dep — must not throw
  });

  it('retries a truncated-JSON transport response instead of throwing straight through', async () => {
    // A provider glitch can truncate the streamed body mid-object; the retry
    // should re-issue the whole call (parse lives inside withRetry) and
    // succeed once the provider returns a complete response.
    const create = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"topic": "AI"' } }] }) // truncated
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"topic":"AI"}' } }] });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    const t = new OpenAITransport(deps(client));

    await expect(t.completeJson('p', { tier: 'cheap', maxTokens: 10 })).resolves.toEqual({
      topic: 'AI',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
