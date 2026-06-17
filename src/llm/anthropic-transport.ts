import Anthropic from '@anthropic-ai/sdk';
import type { ChatTransport, CompletionOptions } from './chat-transport.js';

export interface AnthropicTransportDeps {
  /** Cheap high-volume tier (ADR-0006), e.g. claude-haiku-4-5. */
  readonly cheapModel: string;
  /** Deep analysis tier (ADR-0006), e.g. claude-opus-4-8. */
  readonly deepModel: string;
  /** Injectable for testing; defaults to a real client reading ANTHROPIC_API_KEY. */
  readonly client?: Anthropic;
}

/** Extract concatenated text from a Messages response. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/** Pull the first JSON object out of model text (tolerates ``` fences / prose). */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`no JSON object in: ${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Anthropic `ChatTransport` (ADR-0016) — the thin provider half of the Reasoner.
 * Picks the model for the requested tier and sends; JSON mode parses the first
 * JSON object out of the reply text. No prompts or schemas live here.
 */
export class AnthropicTransport implements ChatTransport {
  private readonly client: Anthropic;

  constructor(private readonly deps: AnthropicTransportDeps) {
    this.client = deps.client ?? new Anthropic();
  }

  private model(tier: CompletionOptions['tier']): string {
    return tier === 'deep' ? this.deps.deepModel : this.deps.cheapModel;
  }

  async complete(prompt: string, opts: CompletionOptions): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model(opts.tier),
      max_tokens: opts.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return textOf(message);
  }

  async completeJson(prompt: string, opts: CompletionOptions): Promise<unknown> {
    const message = await this.client.messages.create({
      model: this.model(opts.tier),
      max_tokens: opts.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return parseJsonObject(textOf(message));
  }
}
