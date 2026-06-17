# ADR-0013: Attention & time budgeting as a pure inverted-pyramid allocator

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

Principle 5 (Attention & Time Budgeting) requires the query layer to map an explicit user
constraint — "a 3-minute rapid text summary" vs. "a 20-minute verbal breakdown" — onto the
pre-computed Significance scores, deciding *how many* Stories to surface and *how much
depth* each gets. The roadmap calls this "the highest-leverage testable unit, like
`computeBaseScore`."

We want this to be a deterministic, side-effect-free kernel (no DB, no LLM, no clock) so it
is exhaustively unit-testable, exactly like `computeBaseScore` (ADR-0008).

## Decision

Ship `budgetStories(stories, minutes, params)` — a **pure function** in the presentation
layer that returns an ordered list of `{ story, depth }` where `depth ∈ headline | brief |
full`. Tunables (`wordsPerMinute`, per-depth `wordCost`) are injected via `params`, keeping
the function pure (ADR-0003 / ADR-0008 style).

The allocation is a two-pass **inverted pyramid**:

1. **Breadth pass.** Convert the budget to a word count (`minutes × wordsPerMinute`), then
   greedily admit Stories in Significance order at the cheapest depth (`headline`) while
   they fit. This fixes *how many* Stories the budget can hold.
2. **Depth pass.** Spend the leftover budget **top-heavy**: walk the admitted Stories in
   Significance order and upgrade each as far as it will go (`headline → brief → full`)
   before moving to the next. The most significant Story gets the most detail.

This yields the intuitive behaviour: a small text budget → a few headlines; a large audio
budget → more Stories with the top ones fully analysed. The presentation layer chooses
`wordsPerMinute` per format (reading is faster than speaking), so the same kernel serves
text, outline, and podcast.

## Consequences

- A single deterministic kernel underlies every generated artifact; format is just a
  different `wordsPerMinute`.
- Fully testable with simple integer tunables (e.g. `wordsPerMinute: 10`, costs `10/20/40`)
  so test arithmetic is obvious.
- `depth` is a contract the renderers (textBrief / outline / podcast) consume — they decide
  what `headline`/`brief`/`full` look like in their medium.
- Edge cases collapse cleanly: `minutes ≤ 0` or a budget below one headline → empty.

## Alternatives considered

- **Single global density** (every Story same depth) — simpler but loses the
  "most-significant-gets-most-detail" editorial behaviour the vision implies.
- **Even-spread upgrades** (all Stories reach `brief` before any reaches `full`) — defensible,
  but top-heavy better matches macro-significance prioritisation.
- **LLM decides the budget** — non-deterministic, untestable, and wasteful; the whole point
  is that allocation is verifiable and the LLM only renders prose (ADR-0006).
