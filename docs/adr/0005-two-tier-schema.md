# ADR-0005: Two-tier schema — raw_items → stories with membership

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The reasoning loop must "upsert the finalized, clean record" repeatedly without duplicating
across ticks, while preserving which Sources corroborated a Story (needed for the
corroboration signal).

## Decision

Separate acquisition from reasoning into **two tiers**:

- **`raw_items`** — verbatim Source payloads, keyed by `(source, externalId)`; extraction
  upserts here idempotently. Immutable provenance.
- **`stories`** — the finalized, classified, scored, Why-It-Matters read-model the
  presentation layer consumes.
- **`membership`** — links many Raw Items → one Story. Its count *is* the corroboration
  signal.

## Consequences

- Re-running a tick never duplicates: extraction upserts by natural key.
- Full provenance retained; the corroboration signal falls out of the membership count.
- The Active Editor updates a Story in place as new corroborating items arrive.
- Slightly more joins than a single flat table; accepted for the provenance + idempotency.

## Alternatives considered

- **Single stories table** — simpler, but loses provenance and the corroboration signal.
- **Event-sourced append-only** — maximal auditability, overkill for Phase 1.
