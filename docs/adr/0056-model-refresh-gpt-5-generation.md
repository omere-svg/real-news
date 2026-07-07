# ADR-0056: Reasoner model refresh to the GPT-5 generation

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

ADR-0012 mapped the Reasoner tiers to `gpt-4o-mini` / `gpt-4o`. That generation is being
retired, and the GPT-5 line changed the wire contract: these are reasoning models that
take `max_completion_tokens` (not `max_tokens`), spend "thinking" tokens out of the same
completion budget, and reject function tools combined with `reasoning_effort` on Chat
Completions (tool calling must go through the Responses API).

## Decision

- **Cheap tier → `gpt-5.4-mini`** — the current high-volume model. Classification,
  merge-confirm, and pre-score run hundreds of times per tick; mini keeps that
  affordable while staying strong enough for merge-confirm, which directly drives dedup
  correctness. (`gpt-5.4-nano` was rejected as below that quality floor; there is no
  `gpt-5.5-mini`.)
- **Deep tier → `gpt-5.5`** — the strongest generally available model, used only for the
  bounded top-N analysis, narration, reflection, and the chat agent, per ADR-0006.
- **`reasoning_effort: 'none'` on every call** — all call budgets are sized for
  output-only tokens; with reasoning on, a 64-token confirm call can burn its whole
  budget before emitting content.
- **`completeWithTools` moves to the Responses API** — required by the provider for
  function tools on this generation; the other transport methods stay on Chat
  Completions with `max_completion_tokens`.
- **TTS stays `gpt-4o-mini-tts`** — the speech endpoint's current model set is
  unchanged; the bare alias tracks the maintained snapshot.
- **Embeddings stay `text-embedding-3-small`** — story vectors are persisted and
  cross-tick dedup compares against them (ADR-0017); changing the embedding space
  without a re-embedding migration silently breaks dedup.

## Consequences

- Best-model-where-it-matters is restored: deep analysis quality rises with gpt-5.5
  while the per-tick bill stays governed by the mini-class cheap tier.
- The `openai` SDK is upgraded to v6 (typed `reasoning_effort`, Responses API); tool
  calls now arrive as a function/custom union and are filtered to function calls.
- A future embeddings upgrade needs a migration that re-embeds or wipes stored vectors.

## Alternatives considered

- **`gpt-5.5` for both tiers** — simplest, but ~6.7× the cheap-tier cost for work a
  mini-class model does well; contradicts the ADR-0006 tiering intent.
- **`gpt-5.5-pro` for the deep tier** — 6× the price of gpt-5.5 for marginal gain on
  short-form analysis; not worth it at current output lengths.
- **Enable reasoning on the deep tier** — potential quality gain, but requires budget
  surgery across every call site and risks empty-content degrades; revisit separately.
