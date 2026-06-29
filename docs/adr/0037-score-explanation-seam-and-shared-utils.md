# ADR-0037: A single Score-Explanation seam + small shared utilities

- **Status:** Accepted — implemented 2026-06-29.
- **Date:** 2026-06-29
- **Deciders:** Project Horizon team
- **Extends:** ADR-0032 (persisted ScoreBreakdown), ADR-0034 (impact-first axes),
  ADR-0035/0036 (dedup embeddings + entity blocking).

## Context

A read-only architecture review (after the ADR-0032–0036 work) found the structure
healthy — every major seam earns its keep — with a handful of **low-severity**
deepening opportunities. This ADR records the small consolidations we chose to make
so a future review doesn't re-flag them, and so the reasoning is on record.

The one finding worth acting on: the *interpretation* of a `ScoreBreakdown` (which
axis label means what, the thresholds that turn values into words like "major
real-world impact") was decoded in **two** renderers — the brief/bot text rationale
(`presentation/horizon-query`) and the web "Why this score?" widget
(`server/ui`) — each with its own string-keyed lookups, labels and magic numbers. A
third surface would copy it again.

## Decision

1. **Score Explanation seam.** Add `presentation/score-explanation.ts` — a pure
   `scoreExplanation(breakdown)` that interprets a `ScoreBreakdown` into render-ready
   facts (labeled, sorted **drivers**; compact **tags**; recency / corroboration /
   nudge), with the axis labels (`COMPONENT_LABELS`) and the tag thresholds living
   **here only**.
   - `horizon-query`'s `scoreRationale` now formats `scoreExplanation(bd).tags`.
   - `server/ui` injects `COMPONENT_LABELS` into the client script (one source of
     truth for axis labels across the server-rendered text and the browser widget).
   - One unit test (`score-explanation.test.ts`) is now the test surface for the
     thresholds, instead of them being implicit in renderer assertions.
2. **Shared scoring math.** `scoring/normalize.ts` holds `clamp` / `clamp01` /
   `normalize`, used by both `compute-base-score` and `signal-context` (the
   log-normalization curve lived in two places).
3. **Shared XML helpers.** `sources/xml.ts` holds `xmlText` / `asArray`, used by
   both `rss.ts` and the dedicated `gdacs.ts`. Each adapter still owns its own
   `XMLParser` config — those deliberately differ and are **not** shared.
4. **Index-alignment guard.** A `tick-runner` integration test asserts each persisted
   Story carries its **own** analysis, locking the `score → analyze → upsert` order
   assumption (`Promise.all` preserves order) so a future async refactor can't
   silently mis-pair Stories.

## Consequences

- **Easier:** the breakdown's meaning has one home + one test; adding a third
  breakdown consumer (e.g. a JSON field) reuses `scoreExplanation`. The duplicated
  scoring/XML helpers are gone. The order assumption is now test-enforced.
- **Bounded:** four small pure modules/tests; no behavior change, no schema change,
  no new dependency. The deletion test passes for `score-explanation` (its logic
  would otherwise reappear in each renderer).
- **Explicitly NOT done** (recorded so reviews don't re-suggest): carrying
  `dedupText` on `EmbeddedItem` to avoid the entity-blocking double-compute — it's
  opt-in and sub-millisecond, so YAGNI; and folding GDACS's `XMLParser` into the
  shared RSS parser — the configs conflict and the seam is correct as-is.

## Alternatives considered

- **Leave the interpretation duplicated.** Rejected: it's the one finding that
  passes the deletion test, and score transparency is a feature we keep extending.
- **Render the breakdown server-side and ship HTML to the client.** Rejected: the
  web viewer is a client-fetch read-model (ADR-0011); injecting the shared *labels*
  keeps one source of truth without moving rendering to the server.
