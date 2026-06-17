# ADR-0017: Cross-tick dedup via persisted Story embeddings

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

ADR-0007 dedups within a single tick: items extracted in the same pass are blocked by
embedding proximity and merged after a Reasoner confirm. But `cluster()` only ever sees the
current tick's batch, and embeddings are discarded afterwards. So an event first reported at
14:00 and corroborated by a second source at 14:20 becomes **two separate Stories** — the
"active editor" cannot let a story accrete corroboration over hours. This is the roadmap's
biggest correctness gap (Phase 3, step 7).

## Decision

Persist one representative embedding per Story and resolve cross-tick identity each tick.

- **Persist embeddings.** A `story_vectors` table holds `(storyId → vector)` for the Story's
  current representative. Written after each upsert.
- **Resolve stage.** After within-tick `cluster()`, each Cluster is resolved against recent
  stored Stories before scoring:
  1. **Block** — fetch stored vectors for Stories in the *same Region + Topic* updated within
     a recency window (`dedup.recentWindowHours`). Region/Topic partitioning (Principle 3)
     keeps the comparison set small.
  2. **Match** — cosine the Cluster's representative vector against the candidates; take the
     best above `dedup.candidateThreshold` (same threshold as within-tick).
  3. **Confirm** — escalate the best candidate to the Reasoner's `confirmSameStory` (the same
     two-stage blocking+confirm as ADR-0007).
  4. On a confirmed match the Cluster **adopts the existing Story's id** and **merges its
     prior member Raw Items** (loaded from `raw_items`); otherwise it gets a fresh
     deterministic id (`storyIdOf`).
- The merged Cluster flows through **score → analyze → upsert unchanged**, so Significance
  reflects the accumulated corroboration and the Why-It-Matters is refreshed. The stored
  vector is then refreshed to the latest representative.

`storyIdOf` remains the identity safety net: if no match is confirmed (or the Reasoner is
degraded), a re-seen item still resolves to its own stable id, so re-running a tick never
duplicates (idempotency preserved).

## Consequences

- A developing Story accretes corroboration across ticks, not just within one — the core
  "active editor" behaviour.
- The matching heart (`bestMatch`, cosine) is a pure, separately-tested function; the
  orchestration is integration-tested through `TickRunner`.
- Cost stays bounded: blocking by Region+Topic+window, one Reasoner confirm per matched
  Cluster, reusing the existing tiers.
- Known limitation: if two Clusters in the *same* tick match the same stored Story, the
  later upsert wins (rare; the within-tick `cluster()` already merges same-tick duplicates).

## Alternatives considered

- **Keep storyIdOf only** — simple and idempotent, but blind to the same event arriving under
  a different `(source, externalId)`, which is exactly the cross-tick case.
- **sqlite-vec / external vector store** — warranted at scale, but an in-process cosine over a
  Region/Topic/window-bounded set is enough for Phase 1 volumes and keeps the seam swappable.
