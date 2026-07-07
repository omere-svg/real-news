import OpenAI from 'openai';
import type {
  AgentMessage,
  ChatTransport,
  CompletionOptions,
  ToolCapableTransport,
  ToolCompletion,
  ToolSpec,
} from './chat-transport.js';
import { markTransient, withRetry } from './retry.js';

/** One completion's token usage, reported per call for accounting (TokenLedger). */
export interface TokenUsageReport {
  readonly tier: CompletionOptions['tier'];
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export interface OpenAITransportDeps {
  /** Cheap high-volume tier (ADR-0006/0012). */
  readonly cheapModel: string;
  /** Deep analysis tier. */
  readonly deepModel: string;
  /** Injectable for testing; defaults to a real client reading OPENAI_API_KEY. */
  readonly client?: OpenAI;
  /**
   * Fires once per completion with the provider-reported token usage, so the
   * composition root can account spend without this transport knowing about
   * ledgers. Must not throw; omitted ⇒ no accounting.
   */
  readonly onUsage?: (usage: TokenUsageReport) => void;
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

  /** Report the completion's token usage to the accounting seam (when wired). */
  private reportUsage(tier: CompletionOptions['tier'], res: OpenAI.ChatCompletion): void {
    const u = res.usage;
    if (!u || !this.deps.onUsage) return;
    this.deps.onUsage({
      tier,
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
    });
  }

  async complete(prompt: string, opts: CompletionOptions): Promise<string> {
    // Retry transient API blips before the caller degrades the tick (ADR-0047).
    const res = await withRetry(() =>
      this.client.chat.completions.create({
        model: this.model(opts.tier),
        // Reasoning models spend "thinking" tokens out of the completion budget;
        // our per-call budgets (64–700 tokens) assume every token is output, so
        // reasoning stays off or a call could burn its whole cap before emitting
        // any content.
        reasoning_effort: 'none',
        max_completion_tokens: opts.maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    );
    this.reportUsage(opts.tier, res);
    return (res.choices[0]?.message?.content ?? '').trim();
  }

  async completeJson(prompt: string, opts: CompletionOptions): Promise<unknown> {
    // The JSON.parse lives inside withRetry: a truncated/garbled body (the
    // stream got cut mid-object) throws a SyntaxError there. `isRetryable`
    // doesn't treat SyntaxError as transient in general (most are programmer
    // bugs), so this catches it specifically — this is the one call site that
    // knows a parse failure here means a wire fault — and tags it via
    // `markTransient` before rethrowing, so it gets the same retry as a
    // dropped connection instead of throwing straight through to the caller.
    const { res, parsed } = await withRetry(async () => {
      const r = await this.client.chat.completions.create({
        model: this.model(opts.tier),
        reasoning_effort: 'none',
        max_completion_tokens: opts.maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      });
      const content = r.choices[0]?.message?.content;
      if (!content) throw new Error('openai: empty response');
      try {
        return { res: r, parsed: JSON.parse(content) as unknown };
      } catch (err) {
        throw err instanceof SyntaxError ? markTransient(err) : err;
      }
    });
    this.reportUsage(opts.tier, res);
    return parsed;
  }

  /**
   * Tool-selection completion for the chat agent loop (ADR-0053).
   *
   * Uses the Responses API: Chat Completions rejects function tools combined
   * with `reasoning_effort` on current models ("use /v1/responses instead"),
   * and reasoning must stay off here for the same budget reason as above.
   */
  async completeWithTools(
    messages: readonly AgentMessage[],
    tools: readonly ToolSpec[],
    opts: CompletionOptions,
  ): Promise<ToolCompletion> {
    const res = await withRetry(() =>
      this.client.responses.create({
        model: this.model(opts.tier),
        reasoning: { effort: 'none' },
        max_output_tokens: opts.maxTokens,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        input: messages.flatMap(toResponseItems),
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                type: 'function' as const,
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                strict: false,
              })),
            }
          : {}),
      }),
    );
    if (res.usage && this.deps.onUsage) {
      this.deps.onUsage({
        tier: opts.tier,
        promptTokens: res.usage.input_tokens ?? 0,
        completionTokens: res.usage.output_tokens ?? 0,
      });
    }
    const toolCalls = res.output
      .filter((item) => item.type === 'function_call')
      .map((item) => ({
        id: item.call_id,
        name: item.name,
        args: parseArgs(item.arguments),
      }));
    return { text: res.output_text.trim() || null, toolCalls };
  }
}

/** Map one provider-neutral message onto Responses API input items. */
function toResponseItems(m: AgentMessage): OpenAI.Responses.ResponseInputItem[] {
  if (m.role === 'assistant') {
    // An assistant turn fans out: its text (if any) is a message item, and each
    // tool call it made is its own function_call item.
    const items: OpenAI.Responses.ResponseInputItem[] = [];
    if (m.content) items.push({ role: 'assistant', content: m.content });
    for (const tc of m.toolCalls ?? []) {
      items.push({
        type: 'function_call',
        call_id: tc.id,
        name: tc.name,
        arguments: JSON.stringify(tc.args),
      });
    }
    return items;
  }
  if (m.role === 'tool') {
    return [{ type: 'function_call_output', call_id: m.toolCallId, output: m.content }];
  }
  return [{ role: m.role, content: m.content }];
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
