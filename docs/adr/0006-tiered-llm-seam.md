# ADR-0006: Tiered Reasoner (Haiku + Opus) behind an LLMClient seam

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The reasoning loop runs every tick over potentially many items, doing classification,
merge confirmation, pre-scoring, and deep Why-It-Matters analysis. Cost and latency matter
at volume, but the headline analysis deserves a strong model.

## Decision

All model access sits behind an **`LLMClient`** interface — the Reasoner seam. The
production adapter is **`AnthropicClient`**, tiered: **Claude Haiku 4.5** for the cheap
high-volume pass (classification fallback, merge confirmation, pre-score) and **Claude
Opus 4.8** for deep Why-It-Matters analysis on the **top-N** most significant Clusters
only. A `FakeLLM` adapter backs tests with deterministic responses.

## Consequences

- Cost scales with the cheap tier; the expensive tier is bounded to top-N.
- Tests never call the network — the seam is mocked deterministically, so the pipeline is
  fully unit-testable.
- Model IDs and the top-N bound are config (ADR-0003), tunable without code changes.

## Alternatives considered

- **Haiku only** — cheapest, but shallow Why-It-Matters.
- **Sonnet only** — one model, simpler, but pricier per item at volume.
