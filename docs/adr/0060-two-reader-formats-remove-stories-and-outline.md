# ADR-0060: Two reader formats — remove Stories and Topic outline

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

The reader surface had grown four formats: **Stories** (a ranked card list),
**Brief** (a time-budgeted summary), **Topic outline** (a single-topic deep dive),
and **Podcast** (narrated audio). In practice the two middle-weight formats added
little the others didn't:

- **Topic outline** was just a brief filtered to one topic — the Brief already
  takes a topic filter, so the outline was a near-duplicate code path (its own
  `/api/outline` endpoint, `topicOutline` query method, an `outline:<topic>` bot
  menu, an auto-topic picker in the web client, and a router intent).
- **Stories** was a raw ranked feed. The product's pitch is *"what matters, sized
  to your time,"* which the Brief and Podcast deliver directly; the raw list
  competed with that framing and carried the most client code (the score-breakdown
  bars widget, an editor's-note diff, freshness-coupled loading).

Fewer, sharper choices serve the goal better: give people **the read (Brief)** or
**the listen (Podcast)**, and nothing to deliberate over.

## Decision

**Keep exactly two reader formats: Brief and Podcast.** Remove Stories and Topic
outline entirely — no dead code left behind:

- **Web viewer** (`ui.ts`): the format tabs are now just Brief + Podcast (Brief is
  the default). Removed `loadStories`, `editorsNote`, `autoOutlineTopic`, the
  score-breakdown splice (`breakdownHtml`/`SCORE_LABELS`), the `renderScript`
  helper, and the Stories/outline hints. The freshness "updated Nm ago" stat stays
  (it reads `/api/ticks`, not stories).
- **Server** (`app.ts`): removed `GET /api/stories` and `GET /api/outline` and
  their now-unused imports (`StoryQuery`, `scoreExplanation`, `canonical`).
- **Query engine**: removed `topicOutline` from the `QueryEngine` interface and
  `HorizonQuery` (and `renderOutline`). The topic filter lives on the Brief.
- **Telegram bot**: removed the `/outline` command, the `outline` router action
  and its `topic` field, the "🔎 By topic" menu button, the topic picker
  (`sendTopicMenu`), and the `outline:<topic>` callback.
- **Shared render util** (`ui-view.ts`): removed `breakdownHtml` (its only consumer
  was the Stories card).
- **Docs**: README, CONTEXT, and ROADMAP updated; historical ADRs left as-is
  (append-only record).

`StoryRepo.topStories`, significance scoring, `scoreExplanation` (still feeds the
Brief's per-story rationale tags), and the topic vocabulary are all unchanged.

## Consequences

- One clear decision for the reader: read it or hear it. Less UI, less code, less
  surface to secure and test.
- The `/api/stories` and `/api/outline` endpoints are gone; any external caller
  must move to `/api/brief` (which accepts repeatable `topic=` filters).
- The score-breakdown *bars* are no longer shown; the compact score-rationale tags
  still appear on each Brief card, and `/dashboard` retains full observability.

## Alternatives considered

- **Keep Stories as a "power view."** Rejected: it dilutes the "sized to your time"
  pitch and was the heaviest client code to maintain.
- **Fold outline into a query param but keep the tab.** Rejected: the Brief's
  existing topic filter already is that; a separate tab was redundant.
- **Keep the endpoints for API consumers.** Rejected: the mandate was no dead
  code, and an endpoint with no UI consumer is exactly that.
