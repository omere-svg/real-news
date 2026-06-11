# ADR-0007: Dedup by embedding blocking + LLM confirm; local embedder

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The same Story arrives from multiple Sources worded differently. We must cluster them
accurately without an O(n²) LLM bill or non-deterministic batch clustering.

## Decision

Two-step dedup. (1) **Embedding blocking**: compute title embeddings and find near-neighbor
candidate pairs cheaply by cosine similarity above a configured threshold. (2) **LLM
confirm**: the Haiku tier judges "same Story?" only on candidate pairs.

Embeddings come from a **local model** (e.g. `all-MiniLM-L6-v2` via `@xenova/transformers`)
behind an **`Embedder`** interface. Tests inject a deterministic `FakeEmbedder`; the real
model never loads in unit tests.

## Consequences

- LLM cost is bounded to candidate pairs, not all pairs.
- No second LLM vendor, no API key, no network call in the hot loop — fits the local ethos.
- First run downloads the model weights; install weight is larger. Accepted.
- Vectors held in-memory / SQLite for Phase 1; `sqlite-vec` is a clean upgrade path.

## Alternatives considered

- **Heuristic only** (title fuzzy-match) — misses semantically-same stories.
- **LLM clustering pass** — cost grows with batch, less deterministic, harder to test.
- **Voyage/OpenAI embeddings** — quality, but adds a key + network dependency in the loop.
