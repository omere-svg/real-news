# ADR-0055: Score-100 hardening — audit-driven fixes, evidence upgrades, honest claims

- **Status:** Accepted — implemented 2026-07-07.
- **Date:** 2026-07-07
- **Extends:** ADR-0053/0054 (the demo-day pass this hardens), ADR-0051
  (quota once-notice), ADR-0044 (signal history), ADR-0036 (entity blocking).

## Context

A seven-dimension adversarial judge audit (one specialist reviewer per Demo
Day rubric dimension, each instructed to be harsher than the real judge)
scored the project ≈66/100 and produced ranked findings: real bugs that
contradicted the proposal's own claims, evidence that had silently decayed to
"asserted" tier (empty live endpoints, coverage configured but never
installed), and one self-refuting MOAT claim (`signalHistoryDays: 14` pruning
the "cannot be backfilled" time series). This pass closes every confirmed
finding, task-by-task with TDD and per-task adversarial review (31 tasks,
~30 commits, suite 588 → 701 tests).

## Decision (what shipped)

1. **Crash safety.** The tick loop survives lock-acquire and run errors
   (previously an unhandled rejection killed the daemon); a process-level
   `unhandledRejection` backstop logs instead of dying; maintenance steps are
   individually isolated; shutdown is bounded by a 5s timeout.
2. **Reflection integrity.** Receipts persist whenever actions were applied
   (previously dropped on empty advisory text — applied actions could be
   invisible); cadence derives from the persisted tick-report count, so it
   survives deploys; a full-loop integration test drives
   reflect → screen → apply → next tick observably changes
   (`test/pipeline/reflection-loop.test.ts`).
3. **Agent legibility.** The chat agent records a one-line plan as trace
   step 0 (plan→act→observe, literally inspectable at `/api/chat-traces`);
   fallback answers leave traces marked `path: 'fallback'` vs `'agent'`; a
   scripted test proves saved memory reaches the model on the next turn.
4. **Safety hardening.** Public chat-trace questions are redacted to an
   80-char preview at the writer; the output URL guard is a shared parsed-host
   matcher (`src/llm/url-guard.ts`) — suffix-host spoofing, truncated-prefix,
   root-path over-grant, and query/fragment smuggling all closed with
   adversarial tests, and grounding comes only from structured tool-result
   fields (a poisoned snippet body cannot ground its own link); the agent has
   hard tool budgets (3/turn, 8/trajectory) and 4k-char result truncation, so
   the daily spend ceiling is genuinely hard; quota increments are atomic
   (`RETURNING`), refusals never double-charge in either direction, the
   podcast endpoint charges on success only, and `/api/auth/start` and
   `/api/podcast` are per-IP rate-limited.
5. **Correctness fixes.** Retry classification no longer retries programmer
   errors and does retry truncated provider JSON (scoped transient tag);
   uppercase acronyms (WHO/US) survive entity extraction in mixed-case text
   (all-caps headlines stay stopword-filtered); non-finite signal values are
   dropped at the source and guarded before the DB (a NaN/Infinity could fail
   a whole tick — the observed production `SERVER_ERROR: HTTP status 400`
   remains an unconfirmed, self-resolved transient; this is defensive
   hardening, not a root-cause claim); web topic inputs validate through the
   same `canonical()` as the bot.
6. **Product surface.** Analyzed stories carry an English `displayTitle`
   (same deep call, guarded like summaries, preferred on both surfaces);
   punctuation-spacing artifacts cleaned on ingest; single-source stories no
   longer render a contradictory 0% corroboration bar; `/api/stats` exposes
   `subscribers`, `questionsAnswered`, per-tier tokens including `embed`, and
   `ttsCharacters` separately (units never mixed into one total).
7. **Engineering evidence.** Coverage is real and gated (95.66% lines /
   85.45% branches; CI floors 90/80); the viewer's render helpers are
   extracted and tested, including a vm-sandbox behavioral test of the shipped
   client script; deploy gates on typecheck + lint + gated tests and takes a
   DB backup before migrations; all pipeline logging goes through the
   injected structured logger; `signalHistoryDays` is 365 so the moat
   time-series stops pruning itself.
8. **Submission honesty.** The proposal is ≤1,500 prose words, cites only
   verified numbers, names competitors (Ground News, Particle), reframes the
   legality wedge as procurement friction backed by a per-source terms table,
   ships a runnable second-tenant demo (`config/alt.yaml`), and states open
   items (demo recording, live traces populate on use) plainly. The
   `reports/` depth artifacts cited by the proposal are now actually tracked.

## Consequences

- Suite: 701 tests / 86 files (~3s), coverage-gated in CI.
- Every §5 safety claim in the proposal is now demonstrably true in code —
  over-claiming was the audit's most consistent deduction, and the fix was
  usually to make the claim true rather than soften it.
- The production DB was deliberately NOT wiped this pass (judging proximity);
  stats accumulate from 2026-07-07.
