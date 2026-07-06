# ADR-0047: Second integrity & resilience pass

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0017 (cross-tick identity), ADR-0038 (production hardening),
  ADR-0039 (GDELT + backfill), ADR-0040 (Log in with Telegram), ADR-0042
  (retention), ADR-0045 (semantic chat retrieval).

## Context

A fresh-start run (wipe the DB, let the pipeline tick three times, then use every
surface as a user and inspect all collections) surfaced a cluster of correctness,
cost, and resilience defects. None were fatal, but together they degraded output
quality and wasted model spend. The most important findings:

1. **Two writers, one DB.** A lingering local run and the deployed instance both
   ticked the same Turso DB. The pipeline is not concurrency-safe — two writers
   double-count corroboration, race membership reassignment, and each prune what
   the other wrote. Confirmed by a `tick_reports` row written by an external
   process during a local run.
2. **`whyItMatters` wiped for non-top-N Stories.** Each tick re-upserts every
   Story, but the deep tier only analyzes the top-N. The re-upsert wrote `null`
   over any existing summary/why, and a degraded `analyze` returned `''` (not
   `null`), so the backfill could never tell "no analysis" from "analysis said
   nothing". Result: ~90% of Stories had a null `whyItMatters` that never healed,
   and the deep tier's spend was repeatedly discarded.
3. **GDELT 429 every tick.** The story adapter and the tone Signal both call
   `api.gdeltproject.org`, and the tick fires extraction and signal observation
   concurrently — two calls inside GDELT's ~1-req/5s window. (ADR-0039 fixed the
   *health-check* double-call but not the *two-adapter* collision.)
4. **`/api/stories?minSignificance=abc` 500s.** A non-numeric query param reached
   the SQL bind as `NaN`, which libsql rejects, crashing the endpoint.
5. **Un-decoded HTML entities in summaries** (`&#x2F;` shown literally); the lead
   summary stripped entities to spaces instead of decoding them.
6. **Unbounded growth** of `raw_items` (orphan provenance never pruned) and, at
   `signalHistoryDays: 0`, of `signal_observations`.
7. **Unbounded model fan-out.** `classify` and `score` used `Promise.all` over
   every item, and the boot backfill raced live ticks for the same OpenAI budget.
8. **Silent embedder space-mixing.** A transient embeddings error fell back to a
   hash vector with no retry; mixing a hash vector into a store of neural vectors
   breaks cosine dedup for every later comparison.
9. **Pairing-code hijack.** `claim` overwrote a code's `chatId` unconditionally,
   so a second chat could steal a pending web session before the web poll.
10. **Chat grounded on noise** (semantic retrieval returned its top-k with no
    similarity floor, and never fed the factual summary to the model), and menu/
    help taps burned the daily command quota.

## Decision

A focused pass, each change behind an existing seam and covered by a test:

1. **Cross-process tick lock (opt-in).** A single-row `tick_lock` table + a
   coarse advisory lock (`DrizzleTickLock`): a process conditionally stamps
   `lockedUntil` into the future to acquire; the loser skips the tick; a crashed
   holder's lock expires after `lock.ttlMinutes`. Config `lock.enabled` (default
   off; **on** in the committed `horizon.yaml` because this deployment shares a
   DB). The lock is a backstop — the real fix is **one writer per database**.
2. **Preserve analysis on re-upsert.** The tick reads existing summary/why for
   the resolved ids (`StoryRepo.existingAnalysis`) and merges: deep value → prior
   value → deterministic lead (new Story only). `analyze` returns `null` (not
   `''`) on a blank/degraded result, and the backfill preserves prior text on
   `null` and skips no-op writes. Deep summaries now persist across ticks.
3. **Per-host rate limiter.** `rateLimitByHost` serializes and spaces requests to
   self-rate-limited hosts (GDELT, 5s); both GDELT adapters share the wrapped
   fetcher, so they can no longer collide. Other hosts pass through untouched.
4. **Guard numeric query params.** `/api/stories` clamps `limit` and drops a
   non-finite `minSignificance` instead of binding `NaN`.
5. **Decode HTML entities** (numeric, hex, common named) in the lead summary.
6. **Retention.** Prune unreferenced `raw_items` each tick
   (`retention.pruneUnreferencedRawItems`); warn at boot when
   `signalHistoryDays: 0` (keep-all ⇒ unbounded).
7. **Bounded model fan-out.** `classify`/`score` run under `mapWithConcurrency`;
   the boot backfill and every tick share one serialization queue so they never
   contend.
8. **Retry before degrade.** `withRetry` wraps the OpenAI transport + embedder, so
   a transient blip retries rather than silently degrading (and, for the embedder,
   poisoning the vector store with a hash fallback).
9. **Single-claim pairing codes.** `claim` refuses a code already bound to a
   different chat; the original claimant stays idempotent.
10. **Better chat grounding.** Semantic retrieval applies a similarity floor and
    falls back to top-by-significance when nothing clears it; the factual summary
    is included in the grounding context; and free navigation (menu/help/prefs/
    pairing) is exempt from the daily command quota.

## Consequences

- Deep analysis stops being thrown away; the cache converges instead of churning.
- GDELT contributes `Geopolitics` again; the story API can't be 500'd by a bad
  param; summaries read cleanly; the raw/signal tables stay bounded.
- The tick lock makes the shared-DB mistake safe **when enabled**, but adds a DB
  round-trip per tick and a `ttlMinutes` worst-case stall if a holder crashes
  mid-tick. It does not replace the operational rule of one writer per DB.
- New `tick_lock` table ships as migration `0013` (schema is the single source of
  truth, ADR-0002/0005).
