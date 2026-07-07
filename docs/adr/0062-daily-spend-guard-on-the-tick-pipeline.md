# ADR-0062: Restart-safe daily model-spend guard on the tick pipeline

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

The Telegram bot has a persisted, restart-safe daily command quota (ADR-0022),
so reader-facing spend is capped even under open access. The **tick pipeline**
had no equivalent backstop. It is the highest-volume LLM consumer (classify,
impact, analyze, merge-confirm, embeddings run every tick across every source),
and it runs unattended. A retry storm, a prompt loop, a misconfiguration, or an
upstream feed suddenly returning thousands of items could all run up an
unbounded bill between deploys — the one high-spend, no-human-in-the-loop vector
without a ceiling.

## Decision

**Add a restart-safe daily USD ceiling that gates every LLM call.**

- **`SpendGuard`** (`src/llm/spend-guard.ts`) estimates the day's spend as a
  persisted **baseline** (read once at boot from the `usage` token counters for
  the current UTC day) plus the live in-memory `TokenLedger` totals since boot.
  It exposes `spentUsd()` and `isExhausted()`. On a UTC-day rollover the stale
  baseline is dropped, so the cap tracks the correct day without double-counting.
- **`ResilientLLMClient`** takes an optional `budget: SpendBudget`. Before each
  delegated call it checks `isExhausted()`; once the day's estimated spend
  reaches the cap, every call short-circuits to the same neutral fallback the
  client already uses for a transport error, and logs a warning. No new failure
  mode — the pipeline simply degrades, exactly as it does when the model is down.
- **Config** (`spend` block, ADR-0003 schema): `dailyUsdCap` (default **1000**,
  a deliberately high hard backstop — normal operation never touches it; `0`
  disables the guard) and `pricePerMillionTokens` estimates per tier
  (`cheap` / `deep` / `embed`). TTS bills in characters and is out of scope for
  this token model.
- **Composition** (`main.ts`): `buildSpendGuard` seeds the baseline from the
  `usage` repo so a mid-day restart resumes near the correct total rather than
  resetting to zero.

## Consequences

- Runaway pipeline spend now has a hard, restart-safe ceiling that survives
  deploys — matching the discipline the bot path already had.
- The cap is an **estimate** (token counts × configured per-million prices), not
  a billing-accurate figure; it is a safety backstop, not an accountant. Set it
  well above expected spend.
- When the cap trips, the pipeline degrades gracefully (neutral fallbacks) rather
  than crashing — a partial tick, never a lost one.

## Alternatives considered

- **Hard-stop the process at the cap.** Rejected: a crash loses the tick and the
  deterministic, zero-LLM parts of the pipeline (extract, dedup blocking,
  base scoring) that still add value. Degrading is strictly better.
- **Track spend purely in memory.** Rejected: it would reset every deploy, and a
  process that restarts often could blow far past the intended daily ceiling —
  the same bug ADR-0042 fixed for the reflection cadence.

## Addendum — the embedder must honour the cap too (post-review fix)

A code review noted the first cut only gated `ResilientLLMClient`. The tick
pipeline's embedder is a separate `OpenAIEmbedder`, so after the cap tripped the
reasoner degraded while embeddings kept billing every tick — letting estimated
spend climb past the very backstop the cap defines. Embedding tokens are already
counted toward `spentUsd`, so leaving the embedder ungated was inconsistent.

Fix: `ResilientEmbedder` now takes the same optional `SpendBudget`. When the
budget is exhausted it short-circuits to its dependency-free fallback (the
hashing embedder) *without* calling the paid API, and marks the batch
`degraded` — which the TickRunner already refuses to persist (ADR-0065), so the
neural index is never polluted with hash vectors during a spend-capped stretch.
Covered by `test/embedding/resilient-embedder.test.ts` ("skips the paid primary
entirely once the daily spend budget is exhausted").
