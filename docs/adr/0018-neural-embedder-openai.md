# ADR-0018: Neural embedder via the OpenAI embeddings API

- **Status:** Accepted
- **Date:** 2026-06-17
- **Supersedes:** the embedder-source choice in ADR-0007 (the blocking+confirm dedup design
  itself stands).

## Context

ADR-0007 chose a local model (`all-MiniLM-L6-v2` via `@xenova/transformers`) for dedup
embeddings, explicitly rejecting an embeddings API to avoid "a key + network dependency in
the loop." In practice the project shipped a `HashingEmbedder` stand-in (trigram hashing),
and dedup quality is bounded by it — the roadmap's remaining Phase 3 quality item.

Since then ADR-0012 adopted OpenAI for the Reasoner, so the original objection is moot: the
API key and network dependency already exist. A local ONNX model would instead add a heavy
native dependency, a first-run weight download, and slower startup to an otherwise
dependency-light in-process daemon.

## Decision

Implement **`OpenAIEmbedder`** behind the existing `Embedder` seam, using
`text-embedding-3-small` (dimensionality configurable via the API's `dimensions` param,
default 1536). Provider, model, and dimensions are config-driven (`embedder` block).

Wrap it in a **`ResilientEmbedder`** that, on any transport error, falls back to a secondary
`Embedder` (the `HashingEmbedder`, configured to the same dimensionality) — the same
"degrade, don't crash the tick" philosophy as `ResilientLLMClient` (ADR-0001). A tick during
an outage clusters at hashing quality rather than failing.

The seam is unchanged, so nothing downstream (embed stage, cluster, cross-tick resolve)
moves.

## Consequences

- Neural-quality dedup, within-tick and cross-tick (ADR-0017), with no new heavy dependency.
- One embeddings call per tick (titles batched); cost is small and bounded by `maxItems`.
- A transient embeddings outage degrades to hashing-quality dedup for that tick, not a lost
  tick. Mixed neural/hashing vectors across an outage simply fail to match (safe: no false
  merges) — same dimensionality keeps vector lengths consistent.
- `provider: hashing` remains available for fully offline / zero-cost runs.

## Alternatives considered

- **Local `@xenova/transformers`** — fully offline and free per call, but a large native dep,
  model download, and slower cold start; the "local ethos" rationale no longer holds once
  OpenAI is already a dependency.
- **Keep hashing only** — zero cost, but the quality ceiling is exactly what this step exists
  to raise.
