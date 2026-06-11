# ADR-0010: Staged batch pipeline orchestrated by a TickRunner

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

One tick must run extract → persist → classify → embed → cluster → score → analyze →
upsert. Clustering inherently needs the whole batch (items are compared against each
other), so a pure per-item stream fights the dedup design.

## Decision

A **`TickRunner`** (interface: `run(): Promise<TickReport>`) calls **discrete stage
functions** in sequence, each taking the prior stage's output with an explicit input/output
type. The pipeline is **batch-oriented** — it operates on the tick's set of items. Per-Source
extraction failures are caught at the Extract stage and reported, never thrown up the loop.

## Consequences

- Each stage is a pure-ish, independently unit-testable function — ideal for stage-by-stage
  TDD — while `TickRunner` is a deep module hiding all orchestration behind `run()`.
- Clustering gets the full batch it needs.
- `TickReport` gives observability (counts, skipped Sources, errors) for free.
- Not crash-resumable mid-tick; accepted for Phase 1 (Phase 2: DB-driven state machine).

## Alternatives considered

- **Per-item streaming** — better latency, but fights batch clustering; more to test.
- **DB-driven state machine** — robust/resumable, but heavier; deferred to the queue-based
  Phase 2 design.
