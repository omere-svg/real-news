import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAITransport } from '../../src/llm/openai-transport.js';

/** A fake OpenAI client capturing the create() args and returning canned content. */
function fakeClient(
  content: string | null,
  usage?: { prompt_tokens: number; completion_tokens: number },
): { client: OpenAI; create: ReturnType<typeof vi.fn>; responsesCreate: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }], usage });
  // completeWithTools rides the Responses API (its usage keys differ).
  const responsesCreate = vi.fn().mockResolvedValue({
    output: [],
    output_text: content ?? '',
    usage: usage
      ? { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens }
      : undefined,
  });
  return {
    client: {
      chat: { completions: { create } },
      responses: { create: responsesCreate },
    } as unknown as OpenAI,
    create,
    responsesCreate,
  };
}

const deps = (client: OpenAI) => ({ cheapModel: 'cheap-test-model', deepModel: 'deep-test-model', client });

describe('OpenAITransport', () => {
  it('routes the cheap tier to the cheap model and the deep tier to the deep model', async () => {
    const { client, create } = fakeClient('hi');
    const t = new OpenAITransport(deps(client));
    await t.complete('p', { tier: 'cheap', maxTokens: 10 });
    expect(create.mock.calls[0]?.[0].model).toBe('cheap-test-model');
    await t.complete('p', { tier: 'deep', maxTokens: 10 });
    expect(create.mock.calls[1]?.[0].model).toBe('deep-test-model'); // a regression here silently bills deep-tier
    // Reasoning-model wire contract: budget via max_completion_tokens, reasoning off.
    expect(create.mock.calls[0]?.[0].max_completion_tokens).toBe(10);
    expect(create.mock.calls[0]?.[0].reasoning_effort).toBe('none');
    expect('max_tokens' in create.mock.calls[0]?.[0]).toBe(false);
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

  it('completeWithTools rides the Responses API and maps function_call items back', async () => {
    const { client, responsesCreate } = fakeClient(null);
    responsesCreate.mockResolvedValue({
      output: [
        { type: 'function_call', call_id: 'c1', name: 'top_stories', arguments: '{"n":3}' },
        { type: 'reasoning' }, // non-function items must be ignored
      ],
      output_text: '',
    });
    const t = new OpenAITransport(deps(client));
    const res = await t.completeWithTools(
      [{ role: 'user', content: 'q' }],
      [{ name: 'top_stories', description: 'd', parameters: { type: 'object' } }],
      { tier: 'deep', maxTokens: 700 },
    );

    const sent = responsesCreate.mock.calls[0]?.[0];
    expect(sent.model).toBe('deep-test-model');
    expect(sent.reasoning).toEqual({ effort: 'none' });
    expect(sent.max_output_tokens).toBe(700);
    expect(sent.tools[0]).toMatchObject({ type: 'function', name: 'top_stories' });
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'top_stories', args: { n: 3 } }]);
    expect(res.text).toBeNull();
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
