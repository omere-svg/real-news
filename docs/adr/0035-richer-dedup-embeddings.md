# ADR-0035: Richer dedup embeddings (title + body lead)

- **Status:** Accepted — implemented 2026-06-29.
- **Date:** 2026-06-29
- **Deciders:** Project Horizon team
- **Extends:** ADR-0007 (dedup: embedding-blocking + LLM-confirm), ADR-0017
  (cross-tick resolve), ADR-0034 (impact-first scoring — corroboration is a core axis).

## Context

ADR-0034 made **corroboration** (how many independent Sources report an event) a
primary driver of Significance. But real output showed the same event splintering
into separate Stories instead of merging: the Venezuela earthquake appeared as two
near-identical Guardian items (2.8 and 2.7), never clustered, so it earned no
corroboration and scored low.

Root cause: the Embed stage vectorized **the title only**
(`embedder.embed(items.map(c => c.item.title))`). Two articles about the same event
with different headlines — "death toll rises to 1,400" vs. "critical hours to find
survivors" — land far apart in vector space, so the blocking step (`candidatePairs`)
never proposes them as a pair and the Reasoner never gets to confirm the merge.
High-recall blocking is the prerequisite for corroboration to work.

## Decision

Vectorize a **`dedupText`** = the title plus a short, markup-stripped **lead of the
body**, instead of the title alone. Same-event articles share event specifics
(place, casualty figures, named actors) in their body, so they converge in vector
space and clear the candidate threshold — surfacing the pair for the existing
Reasoner confirm (ADR-0007), which remains the precision guard.

- `dedupText` is a pure, unit-tested helper: trims the title, strips markup and
  collapses whitespace in the body, takes the first ~320 chars as the lead, and
  joins them. Title-only items (no body) embed exactly the title as before — so the
  change is a strict superset.
- The blocking **threshold and the LLM confirm are unchanged**: richer text only
  *raises* same-event similarity, so precision is still gated by the Reasoner, not
  by the embedding. Cross-tick `resolve` (ADR-0017) benefits automatically — it
  reuses the same per-item vectors.

## Consequences

- **Easier:** same-event articles across outlets (and across ticks) now cluster,
  so corroboration accrues and a widely-reported event climbs the score the way
  ADR-0034 intends; duplicate near-identical Stories collapse into one.
- **Bounded:** one pure helper + a one-line change in the Embed stage. No schema,
  no new dependency; neural and hashing embedders both just receive a longer string.
- **Cost:** embedding inputs are a few hundred chars longer (negligible for
  `text-embedding-3-small`); more candidate pairs may clear the threshold, so a
  modest increase in cheap-tier confirm calls — bounded by per-source `maxItems`.
- **Accepted trade-offs:**
  - **Stored vectors are mixed during rollout.** Vectors written before this ADR
    are title-only; new ones are title+lead. Both come from the same model, so
    cosine stays meaningful; the corpus self-heals as Stories are re-scored.
  - **Threshold not retuned here.** Richer text shifts the similarity distribution
    upward; the existing `candidateThreshold` stays (recall improves at it). A data-
    driven retune is a follow-up if over-/under-merging shows up on the dashboard.

## Alternatives considered

- **Lower the candidate threshold instead.** Rejected as the primary fix: it raises
  recall indiscriminately (more cross-topic noise and confirm calls) without giving
  the embedding the event specifics it needs; can be combined later if needed.
- **Embed the full body.** Rejected: long bodies dilute the title's signal and cost
  more; a capped lead carries the discriminating specifics.
- **Cluster by shared named entities.** Rejected for now: needs an entity extractor;
  the body-lead embedding captures most of the benefit at a fraction of the work.
