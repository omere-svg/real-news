# ADR-0038: Tick throughput, cross-topic dedup, and read-model integrity

- **Status:** Accepted — implemented 2026-07-05.
- **Date:** 2026-07-05
- **Deciders:** Project Horizon team
- **Extends:** ADR-0001 (in-process loop), ADR-0007/0017 (dedup blocking + cross-tick
  resolve), ADR-0009 (classification), ADR-0033 (tick reports), ADR-0034 (impact-first),
  ADR-0035/0036 (richer dedup embeddings + entity blocking).

## Context

A deep review of the **live production database** (Turso, 478 ticks) surfaced four
real problems the unit tests couldn't see, all rooted in cross-tick behaviour at scale:

1. **Ticks overran the interval.** Wall-time was ~17–21 min against a 15-min
   `tickIntervalMinutes`, and `main.ts` fired `setInterval(runTick)` with no
   re-entrancy guard — so ticks overlapped and ran concurrently against one DB. The
   slowness came from two stages that awaited their LLM calls **serially**: `cluster`
   (one `confirmSameStory` per candidate pair) and `resolve` (per-cluster
   `recentVectors` + `get` + `confirmSameStory` over ~220 clusters).
2. **~40 member-less Stories.** Reassigning a member to a fresh Story id releases it
   from its prior owner (`(source, externalId)` is unique); if that owner had only
   that member it was left empty, its `stories`/`story_vectors` rows lingering.
   Overlapping ticks amplified this.
3. **Dedup under-merged same-event coverage.** `resolve` only matched **within the
   same Topic**, but the same event was often classified inconsistently across sources
   (an earthquake as `Other` from Wikipedia, `Geopolitics` from the Guardian world
   feed, `Climate` from USGS) — so the same-Topic gate made a merge impossible. The
   2026 Venezuela earthquakes appeared as 13+ separate Stories.
4. **`Other` over-used (~22%), enrichment lagged.** The classify prompt named the
   Topics but defined none, and the Guardian *world* feed was hard-coded to
   `Geopolitics`, short-circuiting the classifier. Separately, `whyItMatters` sat null
   on ~91% of Stories because the boot backfill's `needsSummary` skipped any Story that
   already had a (deterministic fallback) summary but no analysis.

## Decision

1. **Tick throughput + safety (problem 1).**
   - A `mapWithConcurrency(items, limit, fn)` helper (`pipeline/concurrency.ts`) runs
     the `cluster` and `resolve` confirm calls with bounded concurrency
     (`dedup.confirmConcurrency`, default 8). Both stages only *read* the store during
     their pass, so parallelising is safe; results are applied deterministically in
     input order (union-find and id-folding are unchanged).
   - `main.ts` gets a re-entrancy guard (`ticking`) so `setInterval` never starts a
     second tick over a running one, and `tickIntervalMinutes` is raised to 20.
   - Measured effect: a real tick dropped from ~17.5 min to **~1.3–1.6 min**.
2. **Read-model integrity (problem 2).** `StoryRepo.pruneOrphans()` deletes Stories
   with no membership rows (and their vectors), called once at the end of every tick.
   Deterministic now that ticks can't overlap.
3. **Cross-topic resolve (problem 3).** `resolve` gains a config-gated `crossTopic`
   (`dedup.crossTopic`, default **on**): it matches a Cluster against recent Stories of
   **any** Topic, still gated by the high cosine threshold **and** the LLM
   `confirmSameStory` check (the guard against false merges). On a confirmed match the
   Cluster adopts the **existing** Story's Topic so a later, differently-classified
   member can't make the Topic flap. `recentVectors`' Topic filter became optional.
   `resolve` also folds two Clusters that land on the same Story id into one (they'd
   otherwise clobber each other in the upsert loop and orphan members).
4. **Classification + enrichment (problem 4).**
   - The classify prompt now defines every Topic (notably `Climate` = natural
     disasters/extreme weather + climate science) and says to use `Other` only as a
     last resort.
   - The Guardian *world* feed no longer hard-codes a Topic — its items flow through
     the classifier, which also lets same-event articles converge on one Topic (feeding
     problem 3's fix).
   - Backfill targets `needsAnalysis` (missing summary **or** missing whyItMatters), and
     a steady-state `reasoner.backfillPerTick` (default 0; 8 in prod) heals a few
     Stories per tick so the whole cache converges over time, not only on boot.

## Consequences

- **Verified on real data** (3 ticks, fresh DB, real sources + OpenAI): `Other`
  22% → **6%**; disasters classify as `Climate` (Venezuela quakes now one `Climate`
  Story at significance 10, not fragmented); **0** member-less Stories, **0** orphan
  memberships, **0** missing vectors; tick wall-time ~1.5 min. No cross-topic
  over-merge observed — the large clusters were legitimate same-event/same-bill groups.
- **Bounded / reversible:** every change is behind a config flag with a safe default
  (`crossTopic`, `confirmConcurrency`, `backfillPerTick`); no schema migration. Set
  `crossTopic: false` to revert to same-Topic resolve.
- **Cost:** un-hardcoding Guardian adds ~20 cheap classify calls/tick; the per-tick
  backfill adds a few deep calls/tick — both small and bounded.
- **Residual (not blocking):** classification still has rare edge cases (a sports
  retrospective mentioning an earthquake landed in `Climate`); `whyItMatters` coverage
  converges only as fast as `backfillPerTick` allows.

## Alternatives considered

- **Just raise the interval (no concurrency).** Rejected: hides the cost and the
  overlap races; the serial confirm loops were the real bottleneck.
- **Prune inline in `upsert`.** Rejected: a per-tick sweep is simpler, also clears
  historical debris, and is deterministic once overlap is gone.
- **Drop the resolve Topic gate entirely (unconditional cross-topic).** Rejected in
  favour of a config flag defaulting on, so the behaviour is reversible and A/B-able;
  the LLM confirm + threshold remain the real safety net.
- **Fix classification only, keep same-Topic resolve.** Rejected as insufficient:
  sources will still disagree on Topic for some events; cross-topic is the backstop.
