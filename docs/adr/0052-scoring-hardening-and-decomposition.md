# ADR-0052: Scoring-driven hardening, agentic loop, and God-class decomposition

- **Status:** Accepted — implemented 2026-07-07.
- **Date:** 2026-07-07
- **Extends:** ADR-0006/0016 (Reasoner seams), ADR-0022/0031 (quotas), ADR-0042
  (reflection), ADR-0049–0051 (review + fixes).

## Context

A review against the Demo-Day rubric (agentic depth 25, engineering 20, product 15,
MOAT 15, safety 15, complexity 5, demo 5; evidence tiered asserted<present<
demonstrated) drove a focused pass to maximize each dimension, plus the two
architecture refactors the code review had flagged. Plan: `reports/SCORING-PLAN.md`.

## Decision

- **Safety (last uncapped cost vector):** the public web `/api/podcast` now shares
  the bot's process-wide `global:podcast` daily budget (`utcDay` shared from the
  usage repo), so no cost vector is uncapped. Demonstrated by a test.
- **Agentic depth (close observe→adapt):** `AdaptiveBackoff` — a source failing
  N consecutive ticks is skipped for a cooldown then auto-retried, so a known-bad,
  rate-limited feed (GDELT 429) stops wasting fetches. `TickRunner.run({skipSources})`
  consumes it; `main.ts` records outcomes and feeds them back. Turns the reflection
  loop from observation into genuine adaptation. Pure + fully unit-tested.
- **Engineering — `LLMClient` role split:** the 10-method interface is split into
  `PipelineReasoner` / `ChatReasoner` / `Narrator` / `Reflector`; `LLMClient` is
  their intersection; the tick pipeline now depends only on `PipelineReasoner`, not
  the bot's NLU. `ResilientLLMClient`'s per-method boilerplate becomes one generic
  `guard(op, call, fallback)` with the fallback declared as data.
- **Engineering — `HorizonBot` decomposition:** extracted `QuotaGuard` (limits +
  counters + free-command exemption + limit messages), `SessionStore` (session
  lifecycle + eviction + bounded history), and `ChatGrounding` (semantic-vs-top
  retrieval). The bot drops 1037 → 835 lines and becomes a thin dispatcher; each
  collaborator is independently unit-tested.
- **Submission:** `submissions/project-horizon/proposal.md` (evidence-led, every
  section mapped to a dimension, injection example fenced, no judge-instructions).
- **Docs synced** to the codebase (README/ROADMAP: web podcast on, Oracle VM,
  knesset-votes disabled, counts).

## Consequences

- Every cost vector is capped; the agent visibly adapts to failing sources; the
  Reasoner seam and the bot are decomposed into small, tested units (460 tests).
- No behavior regressions — the full suite + `verify:bot` gate every change.
- Remaining backlog (documented, deferred as lower-value/higher-risk): grouping
  `TickConfig`, lifting scoring constants to config, impact/embedding memoization,
  `RawItemRepo.getMany`, full `main.ts`/`ui.ts` coverage.
