# ADR-0011: Presentation layer is interfaces + stubs only in Phase 1

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The vision includes a user-facing query engine (text brief, audio podcast script, topic
outline) that reads the cache and budgets attention by Significance. But Phase 1 is
"strictly the automated storage and reasoning engine" — features #1–3.

## Decision

Design the full presentation architecture — a read-only **`QueryEngine`** interface and its
contracts (filters by Region/Topic/time-budget, brief/podcast/outline generators) — but
ship them as **un-implemented stubs**. Only features #1–3 (Extraction Worker, two-tier
schema, reasoning loop) get real, TDD'd implementations.

## Consequences

- The schema is designed against real read contracts, so it won't need reshaping in Phase 2.
- The system stays coherent and extensible without scope-creeping the MVP.
- Stubs throw an explicit "not implemented" so accidental use fails loudly.
- The QueryEngine is strictly read-only — it never makes real-time external calls
  (Principle 4: presentation reads the pre-compiled cache only).

## Alternatives considered

- **Implement one read path** — proves the read model, but expands scope past the 3 features.
- **No presentation design at all** — leanest, but risks a schema that doesn't serve reads.
