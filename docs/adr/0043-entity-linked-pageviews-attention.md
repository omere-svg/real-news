# ADR-0043: Entity-linked Wikipedia Pageviews attention

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0025 (Signal seam + partition nudge), ADR-0036 (entity
  extraction), ADR-0034 (impact-first scoring).

## Context

Wikipedia Pageviews attention (ADR-0025) was applied at the **partition** level:
Hebrew views nudged all of `Israel`, English views nudged everything globally. But
the raw data is per-*article* — a spike on "Cristiano Ronaldo" or "Venezuela" is
attention on a *specific* entity, and flattening it to a whole Topic wastes that
precision (and can over-nudge a topic on the back of one unrelated hot article).

## Decision

Carry attention down to the individual story via entity matching:

1. `SignalObservation` gains an optional `entity` — the Pageviews article title,
   normalized (underscores → spaces, lowercased) to match `extractEntities`
   (ADR-0036). The Pageviews source sets it.
2. `assembleSignalContext` builds an `entitySalience` map (entity → salience),
   scaled by `scoring.entitySignalWeight`, alongside the existing per-topic map.
3. At the Score stage, a cluster's own named entities (extracted from its
   representative's title + lead) are looked up in `entitySalience`; the story's
   Signal nudge becomes the **max** of its Topic nudge and its best entity match —
   so it stays within the single `maxSignalAdjustment` ceiling, never stacked.

Positive-only and bounded, like every Signal nudge. Set `entitySignalWeight: 0`
to revert to the pure partition-level behaviour.

## Consequences

- A hot person/place lifts the *matching* story, not its whole Topic — sharper,
  more faithful attention.
- Reuses the existing deterministic entity extractor (no LLM, no new I/O).
- Match quality is bounded by the regex extractor's recall, but a miss simply
  falls back to the topic nudge — never a wrong boost.
