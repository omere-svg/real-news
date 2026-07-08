# Project Horizon — full code & architecture review (Fable 5)

Three independent read-only review passes (correctness/robustness, architecture/
design, performance/cost/tests) plus verification of the load-bearing findings.
The codebase is genuinely well-seamed and hardened (ADR-0047–0050); these are the
improvements that remain, prioritized by impact-to-effort.

Legend — **Exec** = fixing this pass · **Backlog** = documented, deferred (too
large/risky to land safely right before judging; recommended next).

> **Status (submission note).** This is a *point-in-time* review snapshot, retained as an
> authentic record of what the Fable-5 review found — not a live to-do list. Its `[Exec]`
> items have since landed (e.g. ARCH-2 became the id+vector threading of ADR-0063; the
> poll busy-loop CORR-H1 and the GDELT non-finite-date CORR-M1 are fixed; the role-split
> reasoner interfaces ARCH-1 shipped). Read it as evidence that a real, adversarial review
> happened, then check the ADRs (0055–0065) for the fixes.

---

## Performance (DB round-trips against remote Turso)

- **PERF-1 [Exec] Sequential per-item raw-item upsert** — `db/raw-item-repo.ts:42-66`.
  One awaited Turso round-trip per extracted item (hundreds/tick). The single largest
  remaining DB latency after the ADR-0049 resolve hoist. Fix: `db.batch([...])`
  (chunked), mirroring `story-repo.ts`. VERIFIED. HIGH / LOW.
- **PERF-2 [Exec] Sequential source extraction + signal observation** —
  `pipeline/extract.ts:31`, `pipeline/observe-signals.ts:26`. ~20 story + ~6 signal
  sources fetched strictly serially (tens of network round-trips end-to-end). Fix:
  bounded-concurrency via existing `mapWithConcurrency`, keeping per-source try/catch
  isolation. HIGH / LOW.
- **PERF-3 [Exec] `storyRepo.upsert` re-reads the row it just wrote** —
  `db/story-repo.ts:183` + `tick-runner.ts:154` discards the result. `get()` issues 2
  selects; hundreds of wasted reads/tick. Fix: return the Story built in memory from
  the input (or a void upsert variant). MED / LOW.
- **PERF-4 [Backlog] Serial story-upsert loop** — `tick-runner.ts:152`. Bounded-
  concurrency the loop (writes to distinct ids are independent). MED / MED. (Fix
  PERF-3 first — removes 2 of 3 round-trips per story.)
- **PERF-5 [Backlog] N+1 on each confirmed cross-tick match** — `resolve.ts:110-115`,
  `loadItems` one read per member ref. Fix: `RawItemRepo.getMany(refs)` single query.
  MED / MED.

## Cost (OpenAI)

- **COST-1 [Backlog] `assessImpact` re-called every tick on unchanged persistent
  stories** — `pipeline/score.ts:97`. Dominant per-tick token bill. Fix: memoize
  impact by representative content-hash (persist last impact + hash, skip if
  unchanged). MED-HIGH saving / MED (schema).
- **COST-2 [Backlog] Every raw item re-embedded every tick** — `pipeline/embed.ts:34`.
  Cache vector by `dedupText` hash. LOW-MED.
- **COST-3 [Exec] Chat fallback stuffs 30 stories into the deep-tier prompt** —
  `horizon-bot.ts` (semantic path caps at 12; fallbacks pass limit 30). Fix: lower
  fallback limit to the semantic cap (12). LOW / LOW.

## Architecture & design

- **ARCH-1 [Backlog] `LLMClient` is a 10-method God-interface** spanning pipeline
  reasoning + bot NLU + ops; `ResilientLLMClient` is per-method boilerplate. Fix:
  split into role interfaces (`PipelineReasoner`/`ChatReasoner`/`Narrator`/`Reflector`)
  + a generic `resilient(fn, fallback)` wrapper. HIGH / MED. (Deferred: touches every
  pipeline import — risky right before judging; high-value next.)
- **ARCH-2 [Exec] Pipeline stages joined by positional array-index alignment** —
  `tick-runner.ts:152` rejoins resolve/score/analyze arrays by index with `as` casts;
  no type-level protection. Latent data-corruption seam. Fix: thread `id`+`vector` onto
  the flowing cluster object so the loop reads `analyzed[i].id`. HIGH / S-M.
- **ARCH-3 [Exec] Duplicated + divergent text utilities** — markup-strip in 5 files;
  **entity-decode implemented twice with different coverage** (`tick-runner.ts` full
  table vs `rss.ts` 5 entities) — a real rendering inconsistency, not just DRY;
  `firstSentences`/`leadSummary` sentence-split byte-identical in 2 files; `clamp`
  redefined in `score.ts` + `feedback.ts` despite `scoring/normalize.ts` exporting it.
  Fix: one `text/clean.ts` canonical module. MED-HIGH / S. VERIFIED.
- **ARCH-4 [Exec] Representative-member policy reimplemented in backfill** —
  `domain/cluster.ts` claims sole ownership, but `backfill-summaries.ts:43` re-derives
  the lowest-`(source,externalId)` tie-break. Fix: `representativeRefOf(refs)` in
  domain/cluster, both delegate. MED / S. VERIFIED.
- **ARCH-5 [Exec] Derived text/entities recomputed 2-3×/item** — `dedupText` in embed,
  cluster, and score; `score.ts` imports `dedupText` laterally from `embed.js`. Fix:
  compute once in `embed`, carry on `EmbeddedItem`. MED / S-M.
- **ARCH-6 [Backlog] `TickConfig` optional-feature-flag bag** + ~10 conditional spreads
  in `run()`. Fix: grouped option sub-objects. MED / MED.
- **ARCH-7 [Backlog] `HorizonBot` ~1020-line class** owning transport + quota + session
  + retrieval. Fix: extract `QuotaGuard`/`SessionStore`/`ChatGrounding`. MED / M-L.
  (Deferred: large; high testability payoff but regression risk near judging.)
- **ARCH-8 [Backlog] Story-signal scoring constants hardcoded** (`POINTS_REF` etc.,
  axis caps) while Signal saturation refs are config (ADR-0031) — same category of knob
  split across code/config; `TAG_THRESHOLDS` can drift from scoring caps. Fix: lift to
  `config.scoring`. MED / MED.

## Test-coverage gaps

- **TEST-1 [Exec] Provider transports untested** — `llm/openai-transport.ts`
  (note: the `anthropic-transport.ts` named at review time was never wired — the transport
  is OpenAI-only). Untested `model(tier)` mapping — a regression silently
  routes cheap high-volume traffic to the DEEP model (cost blowout); plus empty-response
  throw, JSON.parse path, `maxRetries:0` contract. HIGHEST-value gap / LOW effort.
- **TEST-2 [Backlog] `main.ts` orchestration untested** (lock/overlap guard, retention,
  backfill scheduling). Integration-flavored.
- **TEST-3 [Backlog] `ui.ts` (782 lines) untested** — embedded browser JS; extract pure
  render helpers to make it testable.
- **TEST-4 [Exec] TTS cost path** — `openai-tts.ts` + `resilient-synthesizer.ts` impl
  untested. LOW effort.

## Minor / docs [Exec]
- Vocabulary drift: `editorialAdjustment` in CONTEXT.md/ADR-0032 but not in
  `ScoreBreakdown`/`score.ts` (only `signalNudge`). Reconcile the doc.
- Provider-comment drift: seam docs say "Haiku vs Opus"/"gpt-4o" while wired transport
  is OpenAI and the seam is provider-agnostic. Normalize to "cheap/deep tier".
- Stale `embedding/embedder.ts` doc ("transformers.js") vs wired `OpenAIEmbedder`.

---

## Correctness & robustness (verified)

- **CORR-H1 [Exec] HIGH — Telegram poll busy-loop on any non-text message** —
  `telegram/poll.ts:24`, `bot-api-transport.ts:104`, `main.ts:558`. The offset only
  advances past the highest *mapped* update, but `toUpdates` drops photo/sticker/voice/
  service messages while `allowed_updates` still delivers them → the loop re-requests
  the same update with no sleep, hammering the API (429/ban) until a newer text update
  arrives. Fix: advance the ack offset past the max *raw* update_id regardless of
  mapping. VERIFIED. HIGH / LOW.
- **CORR-M1 [Exec] GDELT non-finite date aborts the whole tick's persist** —
  `sources/gdelt.ts:24` `parseSeenDate` returns `Date.parse` unguarded (the one adapter
  ADR-0049 missed); a format-valid-but-invalid-calendar `seendate` → NaN → libsql
  rejects the bind → `rawItemRepo.upsert` (outside per-source isolation) fails the tick,
  every tick, until the row ages out. Fix: NaN-guard in the adapter + defense-in-depth
  finite-guard at the repo bind boundary. VERIFIED. MED / LOW.
- **CORR-M4 [Exec] `interpretFeedback` drops ALL feedback on one out-of-vocab enum** —
  `llm/reasoner.ts:85` strict `direction`/`length` enums with no `.catch` (unlike the
  router/prefs schemas). One stray value ("increase") throws the whole parse → the
  user's valid "more AI" is silently lost. Fix: `.catch()` per enum / filter the entry.
  VERIFIED. MED / LOW.
- **CORR-M5 [Exec] Router LLM spend bypasses the global cap for free-command routes** —
  `horizon-bot.ts:213,385`. The ADR-0049 pre-gate peeks counters that `withinQuota`
  never increments for free commands, so plain text routing to help/prefs/remember spends
  a cheap-tier call uncharged, bounded only by the burst limiter. Fix: charge a minimal
  increment for any routed plain-text message. VERIFIED. MED / LOW.
- **CORR-M2 [Backlog] Boot backfill bypasses the cross-process tick lock** —
  `main.ts:416` runs under `runExclusive` (in-process only), not `tickLock`. Violates the
  one-writer guarantee for the boot window (only matters with two writers). Deferred:
  main.ts is untested; low real-world risk. Document.
- **CORR-M3 [Backlog] Unbounded membership accretion + N+1 for perpetually-active
  stories** — `resolve.ts:122,164`. Same root as PERF-5/COST-1; needs an accretion cap
  + batched loadItems. MED / MED.
- **CORR-M6 [Backlog] `usage.incrementAndGet` non-atomic** (increment then separate
  read) — conservative direction (never over-serves). Fix: `RETURNING count`. LOW-MED.
- **LOW bundle [Exec]:** `resolve.dedupeById` should prefer the non-empty vector when
  merging (else a mergeable story persists unvectored); `app.ts` `limit=0.5` floors to 0
  → empty list (use `Math.max(1, floor)`); `hacker-news.fetchItem` should isolate a
  per-item fetch throw (don't lose the batch); podcast personal counter incremented
  before the global check (peek global first); `web-auth.claim` should gate its `linked`
  return on `rowsAffected`.
- **LOW [Backlog]:** http byte-vs-char size cap (ADR-0049 residual); cosine dim-mismatch
  loud guard; retry jitter/408/Retry-After; wikipedia-pageviews colon-title drop; enable
  `PRAGMA foreign_keys`. Documented, low.
- **Verified correct (no action):** tick-lock acquire/release, atomic story-upsert batch,
  web-auth single-claim WHERE guard, XSS safeUrl/esc, NaN query guards, rate-limiter +
  session eviction, feedback-undo, cosine/bestMatch edges. nasa-eonet NaN was a
  cross-reviewer false positive (re-verified: the date is pre-validated).

## This-pass execution plan (Exec items, safe + high-value)
PERF-1, PERF-2, PERF-3, COST-3, ARCH-2, ARCH-3, ARCH-4, ARCH-5, TEST-1, TEST-4, and
the doc/vocab fixes — each TDD, behind existing seams. The large refactors (ARCH-1,
ARCH-7, ARCH-6, ARCH-8, COST-1/2, PERF-4/5) are **deliberately deferred**: they're
high-value but touch broad surfaces, and destabilizing a working, fully-tested system
right before a competition is the wrong trade. They're the prioritized next backlog.
