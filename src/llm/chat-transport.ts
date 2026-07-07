/**
 * The chat transport seam (ADR-0016). The thin, provider-specific half of the
 * Reasoner: send a prompt to a model and return its reply. All editorial
 * reasoning — prompts, schemas, tier choice — lives above this in `Reasoner`;
 * an adapter here only knows how to talk to one provider.
 */
export interface ChatTransport {
  /** Free-form completion → reply text. */
  complete(prompt: string, opts: CompletionOptions): Promise<string>;
  /** Completion constrained to a single JSON object → the parsed value. */
  completeJson(prompt: string, opts: CompletionOptions): Promise<unknown>;
}

export interface CompletionOptions {
  /** Which model tier to use (ADR-0006): cheap high-volume vs. deep analysis. */
  readonly tier: 'cheap' | 'deep';
  /** Upper bound on reply tokens. */
  readonly maxTokens: number;
  /** Sampling temperature; omit for the provider default. Low (≈0.3) locks
   * formatting consistency on the generation prompts (ADR-0050). */
  readonly temperature?: number;
}

// --- Tool-calling extension (ADR-0053) ---
// The chat agent loop needs the model to CHOOSE actions, not just fill slots.
// Kept as a sibling interface so plain `ChatTransport` fakes stay tiny.

/** One tool the model may call: name + description + JSON-Schema arguments. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema (object) describing the arguments. */
  readonly parameters: Record<string, unknown>;
}

/** A tool invocation the model requested. `args` is the parsed arguments object. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** One turn in a tool-calling conversation. */
export type AgentMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly toolCalls?: readonly ToolCall[];
    }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly content: string };

/** What one tool-capable completion returns: final text OR tool requests. */
export interface ToolCompletion {
  readonly text: string | null;
  readonly toolCalls: readonly ToolCall[];
}

/** A transport that supports model-driven tool selection (ADR-0053). */
export interface ToolCapableTransport {
  completeWithTools(
    messages: readonly AgentMessage[],
    tools: readonly ToolSpec[],
    opts: CompletionOptions,
  ): Promise<ToolCompletion>;
}
