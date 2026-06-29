# ADR-0036: Entity-aware clustering (toggleable blocking layer)

- **Status:** Accepted — implemented 2026-06-29.
- **Date:** 2026-06-29
- **Deciders:** Project Horizon team
- **Extends:** ADR-0007 (dedup blocking + LLM confirm), ADR-0035 (title+body dedup
  embeddings), ADR-0034 (corroboration as a core scoring axis).

## Context

ADR-0035 enriched the dedup embedding (title + body lead) so same-event articles
converge. It helps, but pure cosine blocking still misses pairs that a human would
instantly link by their **shared named entities** — e.g. two Venezuela-earthquake
articles whose headlines and framing differ enough that cosine lands just under the
`candidateThreshold`, yet both clearly name *Venezuela*. We want a second blocking
signal so those pairs reach the Reasoner confirm, **without** flooding the confirm
step with unrelated pairs and without a hard-to-revert change.

## Decision

Add **entity-aware threshold relaxation** as an *optional, config-toggled* layer on
top of the existing cosine blocking — not a replacement.

- A pure `extractEntities(text)` pulls candidate named entities from an item's
  title + body lead: capitalized proper-noun phrases and short acronyms, normalized
  to lowercase, with a small stopword filter. No LLM, no I/O — a cheap regex pass.
- In `candidatePairs`, when entity blocking is enabled and a pair shares at least
  `minSharedEntities` entities, the pair is judged against a **lower
  `relaxedThreshold`** instead of the base `candidateThreshold`. Sharing an entity
  *relaxes* the bar; it never proposes a pair on its own with no cosine support — so
  unrelated stories that merely mention the same country still need real similarity.
- The Reasoner `confirmSameStory` remains the precision guard for every proposed
  pair (ADR-0007), unchanged.

**Toggleable & tunable by config** (`dedup.entityBlocking`), the explicit ask:
`enabled: false` makes `candidatePairs` behave **exactly** as before (pure cosine at
the base threshold) — a one-line config revert, no code change. `relaxedThreshold`
and `minSharedEntities` are knobs to trade recall vs. confirm-call cost / precision.

## Consequences

- **Easier:** same-event articles that share entities but sit just below the cosine
  bar now cluster → corroboration accrues (ADR-0034) and duplicates collapse.
- **Bounded & reversible:** one pure module + a guarded branch in `candidatePairs`.
  Default-off-equivalent behavior is one flag away; entity extraction is regex over a
  few hundred chars (negligible latency).
- **Cost:** with the layer on, more pairs clear the relaxed bar → more cheap-tier
  confirm calls, bounded by per-source `maxItems` and the still-meaningful
  `relaxedThreshold`. Watch the `/dashboard`; tune the knobs or flip `enabled: false`
  if precision or latency regress.
- **Accepted trade-offs:**
  - **Heuristic entities.** Regex proper-noun extraction is imperfect (misses
    lowercase concepts, may over-capture). It only *relaxes a threshold* and is
    backstopped by the LLM confirm, so errors degrade to "a few more confirm calls",
    not wrong merges.

## Alternatives considered

- **Entity overlap proposes pairs directly (ignore cosine).** Rejected: any two
  stories naming the same country would pair, exploding confirm calls and risking
  wrong merges; relaxation keeps a real-similarity floor.
- **LLM/NER entity extraction.** Rejected for now: adds latency and cost to the hot
  path; the regex captures most proper-noun overlap at ~zero cost. Can be swapped in
  behind the same `extractEntities` seam later.
- **Just lower the global threshold.** Rejected: indiscriminate — raises confirm
  calls for *all* pairs, not just entity-linked ones.
