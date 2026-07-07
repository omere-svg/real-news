import type {
  AgentMessage,
  CompletionOptions,
  ToolCapableTransport,
  ToolCompletion,
  ToolSpec,
} from './chat-transport.js';
import type { SpendBudget } from './spend-guard.js';

/**
 * Extends the daily spend ceiling (ADR-0062) to the chat agent's tool loop.
 *
 * The pipeline Reasoner degrades at the cap through ResilientLLMClient, and the
 * shared embedder honours the same budget — but the chat agent talks to the
 * provider directly through a ToolCapableTransport, so without this wrapper its
 * multi-step tool loop could keep spending past the very backstop the cap
 * defines (embed + chat tokens already count toward `spentUsd`, so leaving the
 * agent ungated was inconsistent).
 *
 * When the budget is exhausted this short-circuits by throwing before any
 * network call. The bot already treats an agent failure as a signal to degrade
 * to its deterministic, cache-only fixed path (never surfacing the error to the
 * user — see HorizonBot's chat fallback), so the net effect at the cap is:
 * zero further model spend on the chat path, graceful degradation, and an
 * automatic return to normal once the UTC day rolls over.
 */
export class BudgetedToolTransport implements ToolCapableTransport {
  constructor(
    private readonly delegate: ToolCapableTransport,
    private readonly budget: SpendBudget,
    /** Fires once per short-circuited call, for the degrade log. */
    private readonly onExhausted: () => void = () => undefined,
  ) {}

  async completeWithTools(
    messages: readonly AgentMessage[],
    tools: readonly ToolSpec[],
    opts: CompletionOptions,
  ): Promise<ToolCompletion> {
    if (this.budget.isExhausted()) {
      this.onExhausted();
      throw new Error('daily spend cap reached: chat agent paused until UTC midnight');
    }
    return this.delegate.completeWithTools(messages, tools, opts);
  }
}
