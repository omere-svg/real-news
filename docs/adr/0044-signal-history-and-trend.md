# ADR-0044: Persisted Signal history + trend enrichment

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0025 (Signal seam), ADR-0042 (retention), ADR-0031 (saturation).

## Context

Numeric Signals (ADR-0025) were observed fresh each tick and discarded — scoring
saw only a **snapshot**. But a signal that is *rising* (a coin ripping, an article
gaining views, a currency destabilizing) is more newsworthy than one that is
merely high-and-flat. Detecting that needs the previous reading, which we weren't
keeping.

## Decision

Persist observations and reward a rising series:

1. A `signal_observations` table (source, key, topic, value, observedAt) stores
   every tick's readings. `SignalObservationRepo.priorValues(keys)` returns each
   series' most recent value.
2. In the tick, priors are loaded **before** the new readings are recorded, so
   they are genuinely the *prior* values. `assembleSignalContext` then lifts a
   rising observation's salience by up to `scoring.signalTrendBoost` (default 0.5),
   proportional to the fraction it rose. Flat or falling series are untouched
   (positive-only, per ADR-0025). Keys embed their period (e.g.
   `coingecko:bitcoin:YYYYMMDD`), so this measures the trend *within* a period.
3. History is pruned each tick to `retention.signalHistoryDays` days (ADR-0042).

The trend math lives in the pure `assembleSignalContext` (it takes `priorByKey`
as an argument); the repo I/O stays in the tick runner. Persistence is optional —
without the repo wired, scoring is snapshot-only as before.

## Consequences

- A rising signal now visibly out-nudges a flat one of equal magnitude.
- Bounded storage (pruned) and bounded effect (`signalTrendBoost`, clamped to 1).
- Set `signalTrendBoost: 0` for pure-snapshot behaviour; history is still recorded
  for future analysis.
