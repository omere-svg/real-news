# ADR-0064: Structured brief payload — restore the "Why this score?" breakdown

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

ADR-0060 collapsed the reader surface to two formats (Brief and Podcast) and, in
removing the Stories card, also removed the **score-breakdown bars** — the
one-tap "Why this score?" widget that made the significance math auditable. That
was the product's flagship "auditable math" differentiator, and the score data
(`scoreBreakdown`, interpreted by `score-explanation.ts`) was still computed and
persisted — it simply had no reader-facing surface anymore. The Brief kept only
a compact one-line rationale tag per story.

## Decision

**Ship a structured twin of the text brief and render an expandable per-story
breakdown on the Brief cards — additive, not a return of the Stories tab.**

- **Query engine.** `QueryEngine` gains `briefStories(request): BriefStory[]`.
  It reuses the *exact same selection* as `textBrief` (same budget, topic
  filter, preference weighting, same-event diversity guard) and maps each
  selected story to a `BriefStory` with title, topic, significance, url,
  depth-trimmed summary/whyItMatters, rationale tags, and interpreted score
  drivers (`BriefScoreDriver[]`, from the persisted `scoreBreakdown`).
- **API.** `GET /api/brief` now returns `{ brief, stories }` — the plain text
  (unchanged, for the deterministic/no-JS path and provenance) plus the
  structured array.
- **Web viewer.** When `stories` is present the client renders cards with an
  expandable `<details>` "Why this score?" panel of component bars (impact,
  corroboration, authority, attention, recency, signal nudge); it falls back to
  parsing the text brief when the structured payload is absent.

## Consequences

- The auditable-math differentiator is back on the reader surface, driven by the
  data already in the store — no new scoring, no new persistence.
- It's an enhancement to the Brief, not a third format: the "read it or hear it"
  framing of ADR-0060 holds; there is no separate Stories tab or `/api/stories`.
- The text brief remains the ground-truth artifact (the podcast narrates it, the
  no-JS path renders it); the structured payload is a richer view of the same
  selection.

## Alternatives considered

- **Re-introduce the Stories tab.** Rejected: ADR-0060's simplification stands;
  the breakdown belongs *on* the Brief, not in a competing feed.
- **Expose the raw `scoreBreakdown` and compute labels client-side.** Rejected:
  the interpretation (`score-explanation.ts`) is shared server logic and already
  tested; duplicating it in the client would drift.
