# ADR-0045: Semantic retrieval over story_vectors for chat grounding

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0029 (chat about the news), ADR-0017 (story_vectors),
  ADR-0007/0018 (embeddings).

## Context

Chat grounding (ADR-0029) fed the Reasoner the reader's **top Stories by
significance** (optionally topic-filtered). For a specific question ("what's new
with the Nvidia antitrust case?") the most *significant* stories are often not the
most *relevant* ones — and the answer's quality is only as good as its grounding.
We already persist a representative embedding per Story (`story_vectors`, ADR-0017);
it was used only for cross-tick dedup, never for retrieval.

## Decision

Ground chat on the Stories most **semantically similar** to the question:

1. `StoryRepo.semanticSearch({ vector, limit, topic?, minSimilarity? })` ranks
   stored Story embeddings by cosine to a query vector and returns the top matches
   (hydrated, most-similar first).
2. The bot embeds the question with the **same embedder** the pipeline uses
   (shared instance — stateless), then retrieves via `semanticSearch`. Preference
   topics still filter. It falls back to top-by-significance when the embedder or a
   `semanticSearch`-capable repo isn't wired, or when the embedding is degenerate
   (empty / all-zeros).
3. Gated by `telegram.chat.semanticRetrieval` (default true).

The embedder is an optional bot dependency and `StoryReader.semanticSearch` is
optional on the seam, so existing wiring/tests that pass a top-stories-only reader
keep working unchanged.

## Consequences

- More relevant grounding → better, more on-topic chat answers.
- One extra embed call per question (cheap; chat is already a deep-tier LLM path),
  and an in-process cosine scan of stored vectors (bounded by the cache size).
- Fully reversible via config; the significance path remains the fallback.
