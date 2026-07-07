# ADR-0063: Thread the resolved story id + vector through score→analyze→upsert

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

The tick pipeline resolves each within-tick cluster to a durable Story id
(`resolve`, ADR-0017), then scores, analyzes, and upserts. Historically the
resolved ids and representative vectors travelled **alongside** the cluster
array as separate parallel lists, and the upsert loop re-zipped them by array
index. That coupling was invisible and fragile: any future stage that reordered,
filtered, or parallelized its output (e.g. `score`/`analyze` already run under
bounded concurrency) could silently mis-pair a Story's analysis with the wrong
id or vector — a corruption with no error, caught only by a bespoke alignment
test. (Raised as finding ARCH-2 in the code review.)

## Decision

**Carry the resolved `id` and representative `vector` on the stage objects
themselves, so every join is by value, never by position.**

- `IdentifiedCluster` (from `resolve`) already carries `{ id, vector, cluster }`.
- `ScoredCluster` and `AnalyzedCluster` now also carry `id` and `vector`,
  threaded straight through `score` and `analyze`.
- `score` takes `IdentifiedCluster[]` (not bare `Cluster[]`) and forwards the id
  and vector onto each `ScoredCluster`.
- The upsert loop in `TickRunner` reads `a.id` / `a.vector` off each
  `AnalyzedCluster` — no positional re-zip of separate arrays.

## Consequences

- A future reorder or concurrent-map in any middle stage can no longer silently
  misalign analysis, id, or vector — the association is structural.
- The change is internal plumbing: no schema, config, or behavioural change; the
  existing alignment test still passes and now guards a property the types
  enforce rather than one a convention hoped for.

## Alternatives considered

- **Keep the parallel arrays, add more tests.** Rejected: tests catch the bug
  after it's written; threading the value makes the bug unrepresentable.
- **Key everything through a `Map<clusterRef, id>`.** Rejected: heavier and still
  relies on a stable key; carrying the id on the object is simpler and direct.
