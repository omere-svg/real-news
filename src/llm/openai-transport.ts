import OpenAI from 'openai';
import type {
  AgentMessage,
  ChatTransport,
  CompletionOptions,
  ToolCall,
  ToolCapableTransport,
  ToolCompletion,
  ToolSpec,
} from './chat-transport.js';
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
export class OpenAITransport implements ChatTransport, ToolCapableTransport {
  private readonly client: OpenAI;

  constructor(private readonly deps: OpenAITransportDeps) {
    // Placeholder key so a missing key degrades at call time (via the resilient
    // client) instead of throwing at construction.
    // maxRetries: 0 — retry lives in one layer (withRetry, ADR-0049). Leaving the
    // SDK's default (2) on top would stack to up to 9 attempts per logical call
    // and amplify a real 429 across a tick's fan-out.
    this.client =
      deps.client ??
      new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'missing', maxRetries: 0 });
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
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
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
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    );
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('openai: empty response');
    return JSON.parse(content);
  }

  /** Tool-selection completion for the chat agent loop (ADR-0053). */
  async completeWithTools(
    messages: readonly AgentMessage[],
    tools: readonly ToolSpec[],
    opts: CompletionOptions,
  ): Promise<ToolCompletion> {
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model(opts.tier),
        max_tokens: opts.maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        messages: messages.map(toOpenAIMessage),
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
    );
    const msg = res.choices[0]?.message;
    return {
      text: msg?.content?.trim() || null,
      toolCalls: (msg?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: parseArgs(tc.function.arguments),
      })),
    };
  }
}

/** Map the provider-neutral message shape onto OpenAI's wire format. */
function toOpenAIMessage(m: AgentMessage): OpenAI.ChatCompletionMessageParam {
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content,
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((tc: ToolCall) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
          }
        : {}),
    };
  }
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
  return { role: m.role, content: m.content };
}

/** Model-emitted argument strings are untrusted JSON — degrade to {} on garbage. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
