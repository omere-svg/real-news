# ADR-0016: Split the Reasoner from the chat transport

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

ADR-0006 put all model access behind one `LLMClient` seam; ADR-0012 added an OpenAI
implementation alongside the existing Anthropic one. Each concrete client
(`OpenAIClient`, `AnthropicClient`) re-implemented the *same* editorial reasoning — the
classify / confirm / adjust / analyze / narrate prompts and the three Zod result schemas
were duplicated across both adapters, and the `analyze`/`narrate` prompts were word-for-word
identical. The seam sat too low: the duplicated reasoning was the real implementation, and
it lived in N places. A third provider would have tripled it.

## Decision

Relocate the seam. Keep the pipeline-facing `LLMClient` interface unchanged, but split its
implementation into two modules:

- **`Reasoner`** (one deep module, `reasoner.ts`) — owns every prompt, every Zod schema,
  and the tier choice (`cheap` vs `deep`) per method. Implements `LLMClient`.
- **`ChatTransport`** (a thin new seam, `chat-transport.ts`) — `complete(prompt, opts)` →
  text and `completeJson(prompt, opts)` → parsed object, where `opts` carries the tier and
  token budget. The provider adapters (`OpenAITransport`, `AnthropicTransport`) implement
  only this: pick the model for the tier, send, and apply their own JSON strategy (OpenAI's
  `response_format: json_object` vs. parsing the first JSON object out of Anthropic text).

The composition root wires `ResilientLLMClient(Reasoner(OpenAITransport(...)))`.

## Consequences

- **Locality:** prompts and schemas change in one module.
- **Leverage:** one `Reasoner`, N transports; a new provider is a ~20-line transport with no
  prompts.
- The editorial reasoning is now **unit-testable** against a `FakeTransport` — previously
  the prompts/schemas were never tested (the old clients only hit the network).
- Refines ADR-0006/0012 rather than reversing them: the tiered `LLMClient` seam the pipeline
  consumes is unchanged; tiering simply moved up into the `Reasoner`.

## Alternatives considered

- **Share only the prompts + schemas** (a `prompts.ts` both clients import) — removes the
  duplication but leaves two near-identical clients and the reasoning still untestable
  without a network. The transport split is barely more work and yields the test surface.
