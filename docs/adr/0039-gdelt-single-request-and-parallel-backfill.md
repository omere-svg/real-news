# ADR-0039: GDELT single-request health, parallel enrichment backfill

- **Status:** Accepted — implemented 2026-07-05.
- **Date:** 2026-07-05
- **Deciders:** Project Horizon team
- **Extends:** ADR-0038 (throughput/dedup/integrity hardening), ADR-0004 (sources +
  pre-flight health check), ADR-0006 (deep-tier analyze), ADR-0025 (signal vs story).

## Context

A second deep review — this time of a **freshly wiped production DB refilled by the
ADR-0038 code** (2 ticks, 252 Stories) — confirmed the ADR-0038 fixes landed (Other
22%→7.5%, 0 orphans, 0 duplicate titles, the Venezuela earthquakes collapsed to one
`Climate` Story) but surfaced two residual problems:

1. **GDELT skipped every tick → Geopolitics starved (0.8%).** The Extract stage runs
   `source.healthCheck()` **and then** `source.extract()` for every source. For GDELT
   that is two API calls back-to-back within one tick, but GDELT enforces ~1 request /
   5 seconds — so the probe + extract pair trips the limit and GDELT is perpetually
   `skipped`/`failed`. GDELT is the main world-news feed, so its absence collapsed the
   `Geopolitics` topic.

2. **`whyItMatters` coverage lagged (233/252 null after 2 ticks).** `summary` has a
   deterministic fallback at upsert (`leadSummary` of the source text), but
   `whyItMatters` has none — it is produced only by the **deep** tier (gpt-4o) via
   top-N `analyze` and `backfillSummaries`. `backfillSummaries` also ran its analyze
   calls **serially**, so the boot heal (up to 500 Stories) took many minutes and the
   per-tick trickle was small. Because `analyze` is the expensive model, simply raising
   the count is the wrong lever (it multiplies cost, against the project's cost ethos).

## Decision

1. **GDELT issues one request per tick, with a generous timeout.** `GdeltSource.healthCheck()`
   returns `true` with no pre-flight fetch, so `extract()` is the single GDELT call per tick
   (ticks are 20 min apart, far above the 5s limit). Removing the probe uncovered a second
   cause: GDELT's doc API is legitimately **slow** — an artlist call measured ~13s, over the
   10s global fetch timeout, so `extract()` timed out every tick. `FetchOptions` gains a
   per-request `timeoutMs` override and GDELT uses a generous 25s. The pipeline's per-source
   try/catch still isolates a genuinely-down GDELT — it now surfaces as a `failed` source
   **with its error**, better observability than a silent skip. This is GDELT-specific: other
   sources have generous limits and respond fast, so the probe + 10s timeout stay.

2. **Backfill runs with bounded concurrency, not serially.** `backfillSummaries` takes a
   `concurrency` option (default 8, the ADR-0038 `mapWithConcurrency` utility). The boot
   heal (500) and per-tick trickle now finish in a fraction of the wall-time, so a
   restart heals the whole cache quickly and steady-state convergence keeps up. The
   most-significant-first ordering is preserved: targets are sorted before dispatch, so
   the first `concurrency` in flight are always the highest-significance (the ones most
   likely to be displayed). `reasoner.backfillPerTick` is nudged 8 → 12 (a small,
   cost-bounded bump, not a brute-force increase); concurrency comes from the existing
   `dedup.confirmConcurrency` knob.

## Consequences

- Geopolitics coverage is restored — GDELT contributes items every tick instead of zero.
- The enrichment cache converges to full `whyItMatters` coverage far faster after any
  restart (parallel boot heal) without increasing per-call cost; the deep-model spend is
  still bounded by `backfillMaxOnBoot`, `backfillPerTick`, and `deepAnalysisTopN`.
- `whyItMatters` deliberately has no cheap fallback: an editorial "why this matters" line
  is only meaningful from the deep tier, so the design heals it lazily rather than
  writing a low-value deterministic stand-in.
- Rejected: raising `backfillPerTick`/`deepAnalysisTopN` aggressively (cost), and adding a
  deterministic `whyItMatters` fallback (low editorial quality).
