# ADR-0042: Tick-report retention + an LLM "reflection" advisor

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0033 (tick_reports observability log), ADR-0016 (Reasoner seam),
  ADR-0040 (web sessions — pruned here too).

## Context

`tick_reports` (ADR-0033) grows one row per tick forever, and nothing ever reads
the history back to *learn* from it. We wanted two things: bound the log so it
stays small, and turn the recent history into an actionable operator summary —
"look at the last few ticks as a group and draw conclusions on what to improve".

## Decision

**Retention.** A `retention` config block bounds persisted history each tick:
`tickReports` (keep the most recent N, default 5), `reflections` (default 20),
`signalHistoryDays` (ADR-0044), and `pruneExpiredAuth` (ADR-0040 sessions/codes).
`TickReportRepo.pruneToRecent(keep)` keeps only the newest `keep` rows; the loop
calls it every tick. Keeping the last 5 preserves a viewable window of history
without unbounded growth.

**Reflection advisor.** A new `LLMClient.reflect(ticks)` (deep tier) reads the
trailing window of tick outcomes **as a group** and writes a short operator
advisory — recurring failing/skipped sources, throughput/duration drift, repeated
errors — each with a concrete suggestion. It runs every `reflectEveryTicks` ticks
(default 5) over the last `reflectWindow` ticks (default 5), and the result is
persisted to a new `tick_reflections` table (pruned to `retention.reflections`).
Advisories surface on `/dashboard` and `GET /api/reflection`.

Retention + reflection run in the tick loop's `finally`, so a *failed* tick is
still counted, pruned, and reflected on. A reflection/prune error is logged and
swallowed — it never breaks the loop (ADR-0001 hygiene). `reflect` is wrapped by
`ResilientLLMClient`, degrading to `''` (skip this cycle) on a model outage.

## Consequences

- A small, self-summarizing operational memory: the last 5 ticks are always
  viewable, and the model periodically distills them into "what to improve".
- Bounded LLM cost: one deep call every N ticks, gated by config (`0` disables).
- Set `retention.tickReports: 0` to keep the full log (pre-0042 behaviour).
