# ADR-0032: Persist & surface the Significance score breakdown

- **Status:** Accepted — implemented 2026-06-29.
- **Date:** 2026-06-29
- **Deciders:** Project Horizon team
- **Extends:** ADR-0008 (hybrid significance scoring), ADR-0025 (numeric Signal
  nudge), ADR-0005 (two-tier schema), ADR-0014 (deterministic render).

## Context

Significance is the number the whole product sorts and budgets by, and our core
differentiator is that it is **deterministic and inspectable** — not a black-box
LLM rating (ADR-0008). But until now the *number* was the only thing persisted:
`computeBaseScore` reduced the verifiable Signals to a single float, the Score
stage added a bounded editorial nudge and a bounded numeric-Signal nudge, and the
components were discarded. A reader (or a judge) could see `7.8` but not *why* —
how much came from corroboration vs. popularity vs. recency, or how much the LLM
moved it.

The inputs are cheap and already computed each tick; throwing them away hides the
system's best property. We want to **show the math** on every Story, in both
presentation surfaces.

## Decision

Compute a structured **`ScoreBreakdown`** at scoring time, persist it on the
Story, and render it.

1. **Breakdown is produced where the math lives.** `compute-base-score.ts` gains
   `baseScoreBreakdown(signals, params)` returning the deterministic `base`, the
   `recencyFactor` actually applied, and a per-component **contribution in score
   points** (popularity, engagement, corroboration, toneExtremity, sourceWeight),
   such that the contributions sum to `base`. `computeBaseScore` becomes a thin
   wrapper returning `.base`, so its existing behavior and callers are unchanged.
2. **The Score stage assembles the full picture.** `score()` wraps the base
   breakdown with the **bounded `editorialAdjustment`** and **bounded
   `signalNudge`** it already computes, plus the raw `signals`, into a
   `ScoreBreakdown` carried on `ScoredCluster` (and inherited by
   `AnalyzedCluster`). `base + editorialAdjustment + signalNudge`, clamped, is the
   final `significance` — so the breakdown always reconciles to the stored score.
3. **Snapshot, don't recompute.** The breakdown is persisted as a JSON column
   `stories.score_breakdown` (migration), written by `toStoryUpsert` and read back
   by `StoryRepo`. Recency decays with time, so recomputing later would not match
   the stored `significance`; we snapshot the breakdown as it was at scoring time.
4. **Surface it in both surfaces.**
   - **Web viewer** (`ui.ts`): each Story card gets a collapsible *"Why this
     score?"* that lists each contribution and the two nudges, from the
     `scoreBreakdown` already on `/api/stories`.
   - **Telegram / brief** (`horizon-query.ts`): the deterministic renderer appends
     a compact one-line rationale to the descriptor (e.g.
     `· 4 sources · trending · fresh`) derived purely from the breakdown — no extra
     LLM call, no extra word-budget surprise beyond one short line.

## Consequences

- **Easier:** the headline product claim ("explainable, reproducible scores")
  becomes visible and demoable; the breakdown reconciles exactly to the score.
- **Bounded:** one new pure function, one nullable JSON column, two renderer
  tweaks. The scoring math itself is unchanged — `computeBaseScore` still returns
  the same number.
- **Backfill:** `score_breakdown` is nullable; Stories scored before this ADR show
  no breakdown until re-scored on a later tick. Renderers degrade gracefully when
  it is absent.
- **Accepted trade-offs:**
  - **Snapshot can drift from a live recompute.** The persisted recency factor
    reflects the scoring tick, not read time. This is deliberate: the breakdown
    must reconcile to the stored `significance`, which was also computed then.

## Alternatives considered

- **Recompute the breakdown at read time from stored Signals.** Rejected: recency
  (and the LLM/Signal nudges) are tick-time values; a read-time recompute would not
  match the stored score, defeating the "show the real math" purpose.
- **A per-Story "Why this score?" button in Telegram.** Rejected for now: briefs
  render as one text message, so a per-story button needs per-story messages or a
  callback carrying Story ids. A compact inline rationale is zero extra taps, zero
  extra cost, and survives message-splitting; the richer expandable view lives on
  the web.

## Note — GDELT tone/mentions are not available here (deferred)

While scoping this, we confirmed the GDELT **artlist** endpoint we use returns only
`url/title/seendate/domain/sourcecountry` — **no per-article tone or mention
count**. Those are exposed by separate GDELT modes (`tonechart`/`timelinetone`) as
**query-aggregate** values, not per story. So GDELT contributes to scoring via
corroboration, source weight and recency, but not popularity/tone. Enriching it
(an extra aggregate call per tick, or clustering GDELT articles by event to count
covering domains as a mention proxy) is a separate decision, deferred to its own
ADR rather than fabricating per-article fields.
