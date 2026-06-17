# ADR-0014: QueryEngine renders deterministically; the LLM only narrates the podcast

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

Phase 2 implements the `QueryEngine` stub (ADR-0011): `textBrief`, `topicOutline`, and
`podcastScript`. Each turns the pre-compiled Story cache, under a time budget (ADR-0013),
into a user-facing artifact. The Story already carries everything a brief needs — title,
Region, Topic, Significance, and the `Why-It-Matters` the Opus tier wrote at analyze time.
The question is how much of each artifact the LLM should generate at query time.

Principle 4 forbids real-time external calls in the presentation layer, and the reasoning
work is supposed to happen in the background tick, not on the read path. Calling the LLM to
write a brief on every request would re-do work already cached and add latency.

## Decision

`HorizonQuery implements QueryEngine`, composed from `StoryRepo` + the `budgetStories`
kernel (ADR-0013) + the Reasoner seam (ADR-0006):

- **`textBrief` and `topicOutline` are pure deterministic renders** of already-stored Story
  fields over the budgeted selection — **no LLM call**. `headline`/`brief`/`full` depths
  map to how much of the stored `Why-It-Matters` is shown. `topicOutline` groups the
  topic's Stories by Region. Both are fully unit-testable with no fakes.
- **`podcastScript` is the one LLM artifact.** It budgets at a speaking rate, renders the
  same deterministic brief, then escalates to a new Reasoner method, **`narrate`** (deep
  tier), which turns the brief into spoken-flow narration. Wrapped by `ResilientLLMClient`,
  `narrate` returns `''` on failure; `podcastScript` then **falls back to the deterministic
  brief** so the read path never hard-fails (same degradation philosophy as ADR-0001).

Candidate gathering honours the `BriefRequest`'s `regions`/`topics` arrays by reading a
Significance-ordered pool from `StoryRepo` and filtering in memory (the closed Region/Topic
vocabularies and a single-user local cache make this cheap).

## Consequences

- The read path stays fast and mostly offline; only the podcast touches the model, and even
  that degrades to text.
- `narrate` is added to the `LLMClient` interface and implemented across every adapter
  (OpenAI, Anthropic, Resilient, and the test `FakeLLM`) — one more tiered method, nothing
  structurally new.
- Briefs are reproducible and testable without mocking a model.

## Alternatives considered

- **LLM writes every artifact** — higher prose quality, but re-does cached reasoning, adds
  latency, and makes the read path non-deterministic and network-dependent (violates the
  spirit of Principle 4).
- **No LLM anywhere (podcast is just the brief read aloud)** — fully deterministic, but the
  vision explicitly wants a "unified audio podcast *script*," which reads better as narrated
  prose than as bullet points.
