# ADR-0061: Expanded reflection vocabulary + deterministic policy auto-revert

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

The reflection loop (ADR-0042/0053) lets the model reason over the trailing
window of ticks and propose corrective actions, screened by a deterministic
policy guard before anything is applied. Two gaps limited it:

1. **Narrow vocabulary.** The model could only rest a flaky source
   (`backoff_source`) or re-aim / clear the deep-analysis budget
   (`set_deep_analysis_top_n` / `clear_deep_analysis_top_n`). It had no lever on
   the two other cost/throughput knobs a struggling tick actually needs — how
   many merge-confirm calls run at once (`dedup.confirmConcurrency`) and how
   sensitive cross-tick merging is (`dedup.candidateThreshold`).
2. **One-way ratchet.** A reflection could *tighten* a knob under stress, but
   nothing ever walked the override back. A one-off stress response (a lower
   budget, a narrower concurrency) could persist indefinitely after conditions
   recovered — the adaptation loop never closed.

## Decision

**Widen the screened action vocabulary, and add a deterministic auto-revert.**

- **Two new actions**, each screened and clamped by `reflection-policy.ts`:
  - `set_confirm_concurrency` → integer, clamped to `[1, 16]`.
  - `set_candidate_threshold` → float, clamped to `[0.5, 0.95]`.
  Non-finite or out-of-band values are rejected, never applied. The bounds live
  in `maintenance.ts`'s `POLICY_BOUNDS`.
- **Merge semantics.** `agent_policy` now carries `confirm_concurrency` and
  `candidate_threshold` columns alongside `deep_analysis_top_n`. A reflection
  that touches only one knob reads the current row and writes back a merge, so a
  single-knob update never clobbers the others.
- **Per-tick application.** `TickLoop` reads the policy and passes the three
  overrides into `TickRunner.run`; each downstream stage (classify/cluster/
  resolve/score) uses the effective value, falling back to config when null.
- **Deterministic auto-revert (`maybeRevertPolicy`).** A separate maintenance
  step clears **all** persisted overrides once the last `healthyWindow` ticks
  each ran `ok` (the pipeline itself succeeded; per-source skips/failures are
  adaptive-backoff's concern and don't block a revert). The model can always
  re-impose an override on the next reflection if the stress returns; the
  reflection cadence bounds any oscillation.

## Consequences

- The control loop is genuinely closed: it tightens under stress and relaxes on
  sustained recovery, with no human in the loop and no permanent drift.
- Every knob the model can move is bounded by the deterministic guard — the
  model proposes, the policy clamps, the pipeline applies. A hostile or
  hallucinated action can only ever land inside a safe band.
- `agent_policy` gained two nullable columns (migration `0018`); a null defers
  to config, so an un-reflected instance behaves exactly as before.

## Alternatives considered

- **Let the model clear its own overrides.** Rejected: it already can
  (`clear_deep_analysis_top_n` stays), but relying on the model to remember to
  do so is exactly the ratchet we're fixing. A deterministic revert is a
  guarantee, not a hope.
- **Auto-revert on any single healthy tick.** Rejected: too twitchy — one lucky
  tick would drop a still-needed override. A full healthy window demands
  evidence of *sustained* recovery.

## Addendum — reflect/revert same-cycle coordination (post-review fix)

A code review caught a race in the composition: `maintain()` runs `maybeReflect`
then `maybeRevertPolicy` every cycle. Because a fully-healthy window is the
normal case (individual source failures don't make a tick `!ok`), a reflection
that imposes a *fresh* override on such a window would be cleared by the revert
step in the very same pass — the override never reached the next tick, silently
defeating the adaptation.

Fix: `maybeReflect` now returns `{ appliedPolicyOverride }` (true only when it
set a knob to a live, non-null value; a pure "clear" doesn't count). `main.ts`
carries that flag across the two steps within one cycle and makes the revert
step stand down when an override was just imposed. Revert still fires on any
*later* cycle whose trailing window is healthy and where reflection imposed
nothing new — so a stale override is still walked back, just never the one set
this cycle. Covered by `test/pipeline/maintenance.test.ts` ("a fresh override
imposed on an already-healthy window is NOT cleared the same cycle").
