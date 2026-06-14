# ADR-0012: Reasoner backed by OpenAI (supersedes the provider choice in ADR-0006)

- **Status:** Accepted
- **Date:** 2026-06-14

## Context

ADR-0006 chose a tiered Claude Reasoner behind the `LLMClient` seam. In practice the
available credential is an organization-issued **OpenAI** API key, so the production
Reasoner must call OpenAI instead.

## Decision

Implement an **`OpenAIClient`** adapter satisfying the same `LLMClient` interface and wire
it at the composition root (`main.ts`), still wrapped in `ResilientLLMClient`. Tiers map to
**`gpt-4o-mini`** (cheap: classify / confirm / adjust, via JSON mode) and **`gpt-4o`**
(deep: Why-It-Matters), configurable in `config/horizon.yaml`. Secret is `OPENAI_API_KEY`.

The tiering, prompting, JSON-validation, and degrade-on-failure design from ADR-0006 are
unchanged — only the provider behind the seam differs. The `AnthropicClient` adapter
remains in the tree as the alternative implementation of the same seam.

## Consequences

- The `LLMClient` seam paid off: swapping providers touched one new adapter + one wiring
  line; the pipeline, scoring, dedup, and tests were untouched.
- Model IDs are config, not code — change them to whatever the key can access.
- Two real adapters now satisfy the seam (OpenAI + Anthropic), so it is a real seam, not a
  hypothetical one.

## Alternatives considered

- **Keep Claude (ADR-0006)** — no available Anthropic credential, so not runnable here.
- **Rename the env var only** — insufficient; the SDK and request shape differ, hence a new
  adapter.
