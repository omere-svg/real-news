# ADR-0041: GDELT aggregate tone as a Geopolitics intensity Signal

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0025 (numeric Signal seam), ADR-0031 (source-owned saturation),
  ADR-0004/0039 (GDELT Story adapter + its rate-limit hygiene).

## Context

GDELT is already a Story source (ADR-0004), but its `artlist` endpoint exposes no
per-article tone or mention counts (noted against ADR-0032) — so the rich signal
GDELT is famous for (the *tone* of world coverage) never reached scoring. The
"optional deepening" list called for GDELT signal enrichment; the open question
was how, given `artlist`'s limitation.

## Decision

Add a **GDELT Signal source** (`gdelt-signal`) — a sibling on the existing
`SignalSource` seam, not a change to the Story adapter. It calls GDELT's
`mode=timelinetone` endpoint (the *average tone* of coverage matching a broad
geopolitics query) and emits the **negativity** of the latest reading —
`max(0, -tone)` — as a bounded `Geopolitics` significance nudge. A sharply
negative global news climate (war, disaster, crisis) lifts Geopolitics stories; a
calm/positive climate is neutral, never a penalty (positive-only, per ADR-0025).

Like `GdeltSource`, its `healthCheck` makes **no** probe fetch: a probe
immediately followed by `observe` would be two back-to-back calls and trip
GDELT's ~1-req/5s limit (the ADR-0039 lesson). It declares its own
`saturationReference` (a ~ -6 average tone is crisis-level), so the composition
root derives its scale like every other Signal source (ADR-0031).

## Consequences

- A genuinely new, keyless GDELT signal without touching the Story pipeline.
- Purely additive and bounded by `scoring.maxSignalAdjustment`; disable by setting
  the source `enabled: false`.
- Aggregate, not per-article — it nudges the Topic, not one story. Per-entity
  attention is handled separately (ADR-0043).
