# ADR-0051: Prompt-iteration + code-review pass

- **Status:** Accepted — implemented 2026-07-07.
- **Date:** 2026-07-07
- **Extends:** ADR-0050 (prompts/UX), ADR-0047–0049 (hardening), ADR-0016 (Reasoner
  seam), ADR-0019 (Telegram), ADR-0005 (representative policy).

## Context

Two parallel workstreams (analysis concurrent; the code-edit phases serialized so
prompt edits and review edits never collided):

1. **Prompt iteration** — a throwaway eval harness generated brief/deep-dive/podcast
   content across topic combos from the live cache and scored it vs the DB
   (LLM-judge faithfulness) and vs the internet (web-search checks). Report:
   `reports/PROMPT-ITERATION.md`.
2. **Full code/architecture review** — three read-only Fable-5 review passes
   (correctness, architecture, performance/cost/tests), every finding verified at
   source. Report: `reports/CODE-REVIEW.md`.

## Decision — prompts
`analyze` faithfulness rose 0.68 → 0.89 (specific 0.72, filler 2/10) at 190
instruction words by adding a hard anti-invention rule ("use ONLY facts stated in
the item; never add a number/result/benchmark not written there; for a paper with
no reported outcome, say what it proposes"). `narrate` verified clean/TTS-safe. A
Cuba-blackout summary was confirmed accurate against live web sources. No prompt
exceeds the researched ~150-400-word budget.

## Decision — code fixes (shipped, TDD)
- **CORR-H1 (high):** the Telegram poll loop busy-looped (API hammer → ban risk) on
  any non-text message, because the offset only advanced past *mapped* updates.
  `getUpdates` now returns an `UpdateBatch { updates, ackOffset }`; the offset
  advances past the max *raw* update_id.
- **CORR-M1:** GDELT `parseSeenDate` NaN-guarded (the one adapter ADR-0049 missed);
  defense-in-depth finite-guard at the raw-item bind so no bad date fails a tick.
- **CORR-M4:** `interpretFeedback` drops an out-of-vocab direction/length entry
  instead of throwing away all the user's feedback.
- **CORR-M5:** a routed plain-text message is charged one command even when it
  resolves to a free command, so the global cost cap isn't bypassed by routing.
- **PERF-1:** raw-item upsert batched (`db.batch`), not one round-trip per item.
- **PERF-2:** source extraction + signal observation run bounded-concurrent
  (order-preserving, per-source isolation kept; a throwing health check is now
  isolated, not fatal).
- **ARCH-3:** one canonical `text/clean.ts` (`decodeEntities`/`stripHtml`/
  `collapseWhitespace`) — fixes a real divergence where the two entity decoders
  handled different entity sets, and stops dropping unknown named entities.
- **ARCH-4:** `representativeRefOf` in `domain/cluster` — the backfill delegates
  instead of re-implementing the tie-break.
- **TEST-1:** OpenAI transport tested (model-tier mapping — a cost-critical path —
  plus empty-response throw, JSON parse, temperature passthrough).
- **Low-severity bundle:** `dedupeById` prefers a non-empty vector; `/api/stories`
  `limit=0.5` floors to 1 not 0; HN `fetchItem` isolates a per-item throw; podcast
  global cap checked before charging the personal counter; `claim` returns `linked`
  only when it actually bound the code (`rowsAffected`).

## Deliberately deferred (documented backlog in reports/CODE-REVIEW.md)
The large refactors — splitting the 10-method `LLMClient` God-interface (+ generic
resilient wrapper), decomposing the ~1020-line `HorizonBot`, grouping `TickConfig`,
lifting scoring constants to config, impact/embedding memoization by content hash,
`RawItemRepo.getMany`, the positional array-index-alignment seam, and full
`main.ts`/`ui.ts` test coverage. These are high-value but touch broad surfaces;
landing them right before a competition risks destabilizing a working, fully-tested
system. They are the prioritized next backlog.

## Consequences
- The bot can no longer be knocked into an API-ban loop by a sticker; a bad upstream
  date can't fail a tick; feedback and routing-cost accounting are correct.
- Ticks do fewer DB round-trips (batched raw upsert + parallel extraction).
- One text-cleaning owner; the backfill and pipeline agree on the representative.
- 444 tests (+8); prompts validated against DB and the live internet.
