import OpenAI from 'openai';
import type { ChatTransport, CompletionOptions } from './chat-transport.js';
import { withRetry } from './retry.js';

export interface OpenAITransportDeps {
  /** Cheap high-volume tier (ADR-0006/0012), e.g. gpt-4o-mini. */
  readonly cheapModel: string;
  /** Deep analysis tier, e.g. gpt-4o. */
  readonly deepModel: string;
  /** Injectable for testing; defaults to a real client reading OPENAI_API_KEY. */
  readonly client?: OpenAI;
}

/**
 * OpenAI `ChatTransport` (ADR-0016) — the thin provider half of the Reasoner.
 * Picks the model for the requested tier and sends; JSON mode uses OpenAI's
 * native `response_format`. No prompts or schemas live here.
 */
export class OpenAITransport implements ChatTransport {
  private readonly client: OpenAI;

  constructor(private readonly deps: OpenAITransportDeps) {
    // Placeholder key so a missing key degrades at call time (via the resilient
    // client) instead of throwing at construction.
    this.client =
      deps.client ??
      new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'missing' });
  }

  private model(tier: CompletionOptions['tier']): string {
    return tier === 'deep' ? this.deps.deepModel : this.deps.cheapModel;
  }

  async complete(prompt: string, opts: CompletionOptions): Promise<string> {
    // Retry transient API blips before the caller degrades the tick (ADR-0047).
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model(opts.tier),
        max_tokens: opts.maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    );
    return (res.choices[0]?.message?.content ?? '').trim();
  }

  async completeJson(prompt: string, opts: CompletionOptions): Promise<unknown> {
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model(opts.tier),
        max_tokens: opts.maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    );
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('openai: empty response');
    return JSON.parse(content);
  }
}
