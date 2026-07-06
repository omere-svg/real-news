# ADR-0048: Cycle-1 QA fixes (lock resilience, skip visibility, developing stories, pending sessions)

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0047 (tick lock, single-claim codes), ADR-0033 (tick reports),
  ADR-0017 (cross-tick identity), ADR-0040 (Log in with Telegram).

## Context

The first full QA cycle against the freshly-shipped ADR-0047 code (wipe → three
clean ticks → both user surfaces → cross-run comparison; artifacts in
`reports/cycle-1/`) confirmed the ADR-0047 wins — analysis persists and backfill
converges to 0 nulls, integrity checks all zero, no 500s, 19/19 extended bot
checks — and surfaced four fixable defects:

1. **The tick lock wedged the loop permanently after the QA wipe.**
   `DrizzleTickLock` ensured its singleton row once per process; deleting the row
   out-of-band made every later `acquire()` return false until a restart.
2. **The wedge was invisible remotely.** A lock-skip only `console.warn`ed; with
   no `tick_reports` row, `/api/ticks` and `/dashboard` showed mere absence —
   indistinguishable from a dead process (this cost 20 minutes of diagnosis).
3. **Updates of one developing story never merged.** Five Stories shared the
   title "Ebola disease caused by Bundibugyo virus, DRC" (WHO DON602–612 updates
   of ONE outbreak). Cosines 0.87–0.98 made them candidates, but
   `confirmSameStory` consistently answered false: successive updates with
   different case counts read as "different events" under a prompt that only
   asked "same event?".
4. **Anonymous month-lived session rows.** Every `POST /api/auth/start` minted a
   `web_sessions` row with the full 30-day TTL before any pairing, unauthenticated
   and un-rate-limited; the pruner removes only expired rows.

A fifth suspect — GDELT 429s — proved external: artlist shed load even for
trivial queries from an independent IP with 6-second spacing, while the app's
25s per-request GDELT timeout (ADR-0039) and per-host limiter (ADR-0047) were
correct. It recovered on its own within the cycle.

## Decision

1. **Lock self-heals:** ensure the singleton row on *every* acquire
   (`INSERT..ON CONFLICT DO NOTHING`, one extra round-trip per tick) instead of a
   once-per-process flag. An out-of-band deletion now costs one skipped interval
   at most.
2. **Skips are visible:** a lock-skip writes `lockSkipRecord(ranAt)` to
   `tick_reports` — `ok: true` (a skip is not a failure; the dashboard stays
   green) with the reason in `error` and zero counts.
3. **Developing stories merge:** `confirmSameStory` now instructs that
   successive updates/follow-ups of ONE ongoing event (outbreak, disaster,
   conflict, trial…) are the SAME event even when numbers/dates differ, while
   distinct events sharing a subject or headline (separate votes, filings,
   matches) are NOT. Verified live: all three WHO DON pairs flip to merge;
   counter-cases (two different quakes, two different Knesset bills) stay
   separate.
4. **Pending sessions expire with their code:** `createPending` gives the
   session row `codeTtlMs` (10 min) instead of the 30-day session TTL; the
   promote step in `resolve(token, now, sessionTtlMs)` extends it to the full
   lifetime once pairing succeeds. The full session lifetime starts at pairing,
   not at page-open.
5. **Lock released on shutdown:** a SIGTERM/SIGINT handler releases the
   advisory lock before exit. Observed live: the first post-fix deploy landed
   mid-tick and stalled ticking behind the dead process's 45-minute lease
   (visibly, thanks to §2). systemd restarts happen on every deploy, so without
   this the stall recurs roughly every other deploy.

## Consequences

- A DB wipe (the QA loop's own protocol) no longer silences the pipeline, and
  any future skip is observable remotely.
- Duplicate-title Story fragments stop accumulating for developing events;
  corroboration accretes as CONTEXT.md intends. Watch the next cycle for
  over-merging (the counter-case guard is prompt-level, not structural).
- Unclaimed web sessions are bounded to minutes, not months. `auth/start`
  remains un-rate-limited (documented residual): acceptable now that the bloat
  window is 10 minutes and per-tick pruning holds.
- `WebAuthRepo.resolve` gained a required `sessionTtlMs` parameter (single call
  site); `TickRecord.error` may now be set on an ok row (lock-skips only).
