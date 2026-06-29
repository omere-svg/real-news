# ADR-0033: Persist Tick Reports + an observability dashboard

- **Status:** Accepted — implemented 2026-06-29.
- **Date:** 2026-06-29
- **Deciders:** Project Horizon team
- **Extends:** ADR-0010 (staged batch pipeline / `TickReport`), ADR-0002 (SQLite +
  Drizzle), ADR-0011 (read-only presentation server).

## Context

The tick loop is the heart of the product, yet once deployed it ran blind: the
`TickRunner.run()` already returns a structured `TickReport` (counts, skipped /
failed sources, signal stats), but `main.ts` only `console.log`-ged it and threw
it away. On a hosted box (Render free tier, ephemeral disk) the logs scroll off
and there is no way to answer "is it healthy?", "which source keeps failing?",
"when did the last good tick run?", or "how long do ticks take?". This was the
last real gap in Phase 5 (productionize).

## Decision

Persist every tick's outcome and surface it on a read-only dashboard.

1. **A `tick_reports` table** (migration) stores one row per tick: `ranAt`,
   `durationMs`, `ok` + `error` (so **failed** ticks are recorded too, not just
   successful ones), and the full `TickReport` payload (extracted, storiesUpserted,
   signalsObserved, and the skipped/failed source lists as JSON). Indexed by
   `ranAt` for the "most recent N" read.
2. **A `TickReportRepo` seam** (`record` / `recent`) keeps the store behind an
   interface, like every other repo — pure, swappable, unit-tested against the
   real migrated schema.
3. **The tick loop records each run.** `runTick` in `main.ts` stamps `ranAt` /
   `durationMs` from the system clock and writes a row on **both** the success and
   the catch paths; a failed *write* never breaks the loop (best-effort).
4. **Two read surfaces on the existing server** (still zero-LLM, cache-only —
   Principle 4): `GET /api/ticks?limit=N` returns the recent records as JSON, and
   `GET /dashboard` is a single self-refreshing page showing a health banner
   (last tick, age, healthy/degraded), per-tick rows, and which sources were
   skipped or failed. The `TickReportRepo` is an **optional** dependency of
   `createApp`, so existing wiring and tests are unaffected; the routes degrade to
   empty when it is absent.

## Consequences

- **Easier:** operations can see the engine breathe — uptime, throughput, and the
  exact failing source — without shelling into the host or scraping logs.
- **Bounded:** one table, one repo, two read-only routes, one dashboard renderer.
  The pipeline and scoring are untouched; `TickReport` keeps its shape.
- **Self-trimming option deferred:** rows accumulate (~96/day at a 15-min tick).
  A retention prune (keep last N / last 30 days) is a trivial follow-up; for now
  the read is `recent(limit)`-bounded so the dashboard stays fast regardless.
- **Accepted trade-offs:**
  - **No metrics/Prometheus endpoint.** A JSON feed + HTML dashboard covers the
    single-instance need; a `/metrics` exporter can come later behind the same
    repo if external monitoring is wanted.

## Alternatives considered

- **Keep logging only, scrape stdout.** Rejected: ephemeral on the free host and
  unqueryable; the data already exists structured, so persisting it is cheap.
- **A separate metrics store (Prometheus/StatsD).** Rejected for the MVP:
  operational overhead and a second moving part for a single-instance worker; the
  SQLite row + dashboard is sufficient and consistent with ADR-0002.
- **An LLM "reflection" advisor over past reports.** Deliberately *not* built here:
  it would put a non-deterministic component in the observability path. The
  persisted history is the substrate; a read-only advisor can be layered later
  without changing this decision.
