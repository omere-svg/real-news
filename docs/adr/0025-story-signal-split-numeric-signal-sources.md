# ADR-0025: The Story/Signal split — a companion seam, in-tick observations, and a bounded partition nudge

- **Status:** Accepted — implemented 2026-06-18. Closes the deferral in [ADR-0021](0021-lean-media-aware-source-expansion.md) §2 and roadmap step 9.
- **Date:** 2026-06-18
- **Deciders:** Project Horizon team

## Context

ADR-0021 §2 adopted the **Story vs. Signal split** but deferred its mechanism: "companion
seam vs. discriminated `role` field … left to the building PR." The 7 media/thematic Story
sources shipped without it because they fit the Story pipeline — their popularity/tone ride
in `SourceMetadata` (`points`/`mentions`/`tone`) and `assembleSignals` already reads them.

Two adopted sources do **not** fit that mould — they emit numeric series, not narrative items:

- **Wikipedia Pageviews** (`wikipedia-pageviews`) — per-article view counts; cross-lingual
  reader-attention. `en.wikipedia` ⇒ World, `he.wikipedia` ⇒ Israel.
- **World Bank** (`worldbank`) — macro indicators (GDP, inflation); slow-moving economic context.

Forcing these into `RawItem` would pollute the story feed with rows that have no headline and
should never be shown — exactly what ADR-0021 §2 warns against ("never a standalone story").
This ADR settles three questions the deferral left open: **(1)** how a Signal source plugs into
the seams, **(2)** whether observations are persisted, and **(3)** how a numeric series actually
moves significance.

## Decision

### 1. A companion `SignalSource` seam — not a `role` field on `SourceAdapter`

A Signal source satisfies its own interface, parallel to `SourceAdapter` (ADR-0004):

```ts
interface SignalSource {
  readonly id: SourceId;
  healthCheck(): Promise<boolean>;          // same non-blocking hygiene as SourceAdapter
  observe(): Promise<SignalObservation[]>;  // numeric points, not RawItems
}
```

`SourceAdapter` (the Story seam) is left **completely untouched**, so ADR-0004's promise holds:
adding a source never touches the Story pipeline. The two seams are siblings; `main.ts` routes
each configured source id to the one that builds it. A `role` discriminator on a single seam was
rejected — it would smuggle numeric rows through `RawItem`/`classify`/`cluster`, the precise
pollution we are avoiding. (Sources that are legitimately **BOTH** — Knesset votes, HF Daily
Papers — already work as Story sources carrying their numbers in `SourceMetadata`; they need no
`SignalSource`.)

### 2. Observations are in-tick, not persisted

Signal data changes **slowly** (pageviews are monthly snapshots; World Bank is annual) and is
**CDN-cached** at source. So each tick re-`observe()`s and uses the result within that tick —
no `signal_observations` table, no repo, no migration. This is the deliberate contrast with
`story_vectors` (ADR-0017), which *must* persist because cross-tick dedup needs prior ticks'
vectors. Signals carry no cross-tick state, so persistence would be cost without benefit. (If a
future signal needs trend-over-time, persistence can be added behind the same seam.)

### 3. Coupling: a bounded, partition-scoped `signalAdjustment` — `computeBaseScore` untouched

Observations are folded into significance as a **third bounded term**, alongside the LLM's
editorial nudge (ADR-0008) and never larger than `scoring.maxSignalAdjustment`:

```
significance = clamp(baseScore + editorialAdjustment + signalAdjustment, 0, 10)
```

- `assembleSignalContext(observations)` → a pure map of **salience ∈ [0, 1]** per partition,
  keyed by `(region, topic | null)`. Salience is the partition's peak observed value,
  log-normalized exactly like the base-score signals (`log1p(value)/log1p(ref)`), so it shares
  their diminishing-returns shape.
- `signalAdjustment(region, topic, ctx, max)` → looks up the cluster's exact `(region, topic)`
  salience, falls back to the region-wide `(region, null)` salience, and scales it to `[0, max]`.
  **Positive-only:** attention surges and macro volatility *raise* significance; their absence
  is neutral, never a penalty.

`computeBaseScore` is **not** modified — its weights still sum to 1.0 and all its tests stand.
The signal influence is an explicit, inspectable, bounded post-term, faithful to ADR-0008's
"verifiable signals + a bounded nudge, never a dominating black box."

Per-source mapping:

- **Wikipedia Pageviews** → `region` from project (`en`⇒World, `he`⇒Israel), `topic = null`
  (no native topic; the attention is region-level), `value = views`. Namespace/main-page rows
  (`Special:`, `מיוחד:`, `עמוד_ראשי`, `Main_Page`, `:` entries) are filtered as noise.
- **World Bank** → `region = World`, `topic = Business`, `value = |latest year-over-year %
  change|` of the indicator (volatility, not the raw GDP magnitude — a trillion-dollar GDP
  must not saturate the signal; a 6% inflation swing is what "matters").

## Consequences

- **Easier:** the attention axis (what the public is actually reading) and the macro axis (when
  the economy is moving) now sharpen significance without ever appearing as fake stories. A
  he.wikipedia surge lifts Israel-partition stories in the brief; macro volatility lifts
  World/Business. The Story pipeline and `computeBaseScore` are untouched, so the change is
  additive and low-risk.
- **Bounded blast radius:** new code is one seam, two adapters, one pure coupling module, and a
  third term in `score()`. No schema/migration. Existing score tests pass unchanged because
  `signalContext` defaults to empty (adjustment 0).
- **Accepted trade-offs:**
  - **Region-level attention, not entity-linked.** Pageviews lift a whole partition, not the
    one matching cluster — entity-linking a view spike to a specific story needs NLP/title
    matching we deliberately defer (documented here as the obvious next step). Region-level
    still reorders *across* partitions, which is what the time-budgeted brief allocates over.
  - **World Bank is partition-constant** (World/Business); it reorders Business vs. other World
    topics, not individual Business stories. Honest for a macro context signal.
  - **No history.** In-tick observations can't express "views rose 3× week-over-week" yet;
    accepted until a trend need appears.
- **Cost/limits:** Wikipedia Pageviews requires a `User-Agent` header (sent) and is rate-capped
  (200 req/min unauthenticated); we poll 2 projects/tick. World Bank is Cloudflare-cached
  (~30-day TTL); a handful of indicator calls/tick is well within tolerance.

## Alternatives considered

- **Discriminated `role` field on `SourceAdapter`.** Rejected — routes numeric data through the
  Story types and stages it must never reach.
- **Persist observations in a `signal_observations` table.** Rejected for now — slow-moving,
  CDN-cached data re-fetched each tick needs no cross-tick store; persistence is cost without
  benefit. Revisit only when a trend-over-time signal is wanted.
- **Entity-link pageviews to individual clusters (title/NLP match).** Rejected for the first
  cut — fragile and heavier than the lean MVP warrants; region-level salience captures most of
  the value. Noted as the natural follow-up.
- **Extend `computeBaseScore` with a sixth weighted component.** Rejected — it would re-balance
  the weights-sum-to-1.0 model and perturb every existing score. A bounded post-term is safer,
  more inspectable, and mirrors the editorial-adjustment pattern already in place.
- **Make significance fall when attention/macro is quiet (signed nudge).** Rejected — silence
  on a slow monthly/annual feed is the common case, not a signal of unimportance; a positive-only
  nudge avoids punishing stories for a quiet macro month.
</content>
</invoke>
