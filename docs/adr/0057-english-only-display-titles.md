# ADR-0057: English-only display — translate below-top-N and heal foreign titles

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

Horizon aggregates from 20+ multilingual official sources (GDELT alone carries dozens
of languages), so raw source headlines arrive in Russian, Ukrainian, Hebrew, Arabic,
Spanish, and more. The product is meant to be a single, English reading surface.

Task 20 added a deep-tier `displayTitle` — an English headline written alongside the
summary/why — and every render prefers it over the raw `title` (ADR: the raw title is
kept only as hidden provenance/fallback). But two gaps let non-English headlines reach
the front page:

1. **Below-top-N Stories never got a `displayTitle`.** The deep tier only analyzes the
   `deepAnalysisTopN` most significant Clusters each tick (ADR-0006); every other Story
   carried `displayTitle: null` and therefore rendered its raw — often non-English —
   `title` verbatim.
2. **The backfill wiped `displayTitle`.** `backfillSummaries` re-analyzes Stories that
   are missing a summary/why, but its upsert never included `displayTitle`, so
   `StoryUpsert` defaulted it to `null` — erasing a good English headline on every heal.
   `needsAnalysis` also never targeted a foreign title that lacked one, so such Stories
   never healed. This is why the live screenshots showed an English *summary* under a
   Cyrillic *headline*.

## Decision

- **A cheap-tier `translateToEnglish(title, text)`** on `PipelineReasoner`, returning an
  English `displayTitle` (≤90 chars) + a short English `summary`, guarded by the same
  `editorialField` injection/blank-to-null discipline as `analyze` (ADR-0047/0053), and
  degraded to `{null, null}` by `ResilientLLMClient`.
- **The analyze stage escalates below-top-N *non-English* headlines** to that cheap call
  instead of emitting nulls. Top-N Stories still get the full deep pass; English titles
  below top-N still cost nothing (their raw title is already English).
- **A deterministic gate, `looksNonEnglish` (`src/text/language.ts`)**, decides who pays:
  any non-ASCII **letter** ⇒ translate (covers all non-Latin scripts and accented Latin);
  plain ASCII ⇒ leave it. Punctuation/symbols (— " € °) are not letters and never trip
  it. A false positive costs one cheap call whose prompt leaves English alone.
- **The backfill now carries `displayTitle` through its upsert** and `needsAnalysis`
  targets a foreign title missing an English one, so pre-fix Stories heal on the next
  pass instead of losing their headline.

## Consequences

- The store and every reader surface (web + Telegram) are English-only for practical
  input: non-Latin headlines are always translated at write time, and existing foreign
  headlines heal via the backfill.
- Extra spend is bounded and proportional: one *cheap*-tier call only for below-top-N
  Stories whose headline is actually non-English (the majority — English — pay nothing).
- The raw source `title` is retained as hidden provenance/fallback; it is never the
  rendered headline once a `displayTitle` exists.

## Alternatives considered

- **Deep-analyze every Story** — guarantees English everywhere but discards the ADR-0006
  cost tiering; the whole point of top-N is to not pay deep-tier per Story.
- **Translate at the source/extract boundary** — loses the original headline for
  provenance and debugging, and spends on Stories that never surface.
- **A real language detector for Latin-script text** — would catch unaccented foreign
  Latin (e.g. "El presidente habla hoy") that the letter gate misses, but reliable
  detection needs a model call per item, defeating the cost goal. The deep tier already
  translates such a Story if it reaches the top-N; the residual gap is rare and low-stakes.
```

