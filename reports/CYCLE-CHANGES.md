# Project Horizon — QA cycle changelog (cycles 1 & 2)

What each iterative QA cycle found and shipped. Each cycle = wipe the live DB →
let the deployed server run 3 clean ticks → observe every collection → use both
user surfaces → (cycle 2+) deep-read the codebase for latent defects → prioritized
report → plan → TDD fixes → verify (typecheck + tests + verify:bot) → ship → confirm
→ (cycle 2+) final wipe so the DB holds only fixed-code data.

---

## Cycle 1 — ADR-0048 (shipped 2026-07-06)

**Trigger:** a pre-existing ADR-0047 integrity pass was implemented but never
committed; the prior deploy had frozen the VM by compiling `tsc` on the box.

**Shipped first:** rescued + committed the ADR-0047 pass (tick lock, per-host rate
limiter, LLM/embedder retry, analysis preservation, param guards); moved the build
to CI (`deploy.yml`); added a `vm-ops` diagnostic workflow. Discovered the real
prod URL is `horizon-news.duckdns.org`.

**Fixes (ADR-0048):**
1. **Tick lock wedged permanently after a DB wipe** — `ensured` flag cached per
   process; deleting the lock row stopped all ticking until restart. → re-ensure
   the row on every acquire (self-heals in one interval).
2. **Lock-skipped ticks were invisible remotely** — journald-only warning. →
   write a `lockSkipRecord` to `tick_reports` (ok=true + reason) so /api/ticks and
   /dashboard show *why* nothing ran.
3. **Updates of one developing story never merged** — 5 duplicate-title "Ebola
   outbreak" stories; the confirm prompt read successive WHO updates as different
   events. → prompt now treats updates/follow-ups of one ongoing event as the same
   story (distinct votes/filings still separate).
4. **Anonymous 30-day web sessions** — every `POST /api/auth/start` minted a
   month-lived row unauthenticated. → pending sessions expire with their 10-min
   code; full TTL starts at pairing.
5. **Every mid-tick deploy stranded a 45-min lock lease** (found once fix #2 made
   it visible) — → SIGTERM/SIGINT handler releases the lock on shutdown.

**Result:** typecheck + 407 tests + verify:bot green; 0 orphans, summary/why
converge to 0 nulls, no dup-title stories.

---

## Cycle 2 — ADR-0049 (shipped 2026-07-07)

**New this cycle (per user):** a standing **deep code-audit stage** — 3 parallel
auditor agents (sources / presentation+bot / db+scoring+llm) + a pipeline-core
pass, every finding re-verified at source (several via live endpoint probes); and
a **double wipe** (start + after ship). Planning done by direct reasoning, not
`/ultraplan`.

Observation was clean (0 orphans every tick; ADR-0048 dedup held at 0 dup-title
stories; 19/19 extended bot checks), so the value came from the audit.

**Fixes (ADR-0049), all TDD + shipped:**
1. **Stored XSS** — story URL interpolated into an `<a href>` raw. → client
   `safeUrl` (escape + http(s)-only; drop link otherwise).
2. **Data loss on a transient DB error** — non-transactional story upsert +
   `finally` orphan-sweep could delete an accreted story mid-tick. → three writes
   in one atomic `db.batch`.
3. **SEC EDGAR served 2009-2025 filings as news** (relevance-ranked; verified). →
   date-bound `startdt/enddt` recent window.
4. **Knesset-votes frozen at 2021-07-13** (verified). → disabled in config
   (reversible).
5. **timesofisrael / nber skipped every tick for days** — bot-CDN 403'd the
   anonymous Node fetch (nber 403→200 with a UA). → default descriptive
   User-Agent on all source fetches.
6. **Router LLM call bypassed the daily quota** — routing ran before the quota
   check. → read-only `UsageRepo.peek` gates routing before the model spend.
7. **`resolve` re-fetched all recent vectors once per cluster** (~200 reads/tick,
   the dominant slow-tick cause). → fetch once per tick, memoized; match in memory.
8. **`withRetry` stacked on the SDK's retries** (≤9 attempts) and retried
   permanent 4xx. → classify retryable (429/5xx/network); SDK `maxRetries: 0`.
9. **`less <topic>` un-muted a muted topic** (0 → 0.25). → `less` keeps 0 at 0.
10. **Podcast TTS 400s above 4096 chars but still spent podcast quota.** → clamp
    the script to ~4000 chars at a sentence boundary.
11. **Truthy-unparseable upstream date → NaN → whole-tick failure** (libsql
    rejects NaN). → shared `parseDateOrNull` across all JSON adapters.
12. **Unstable ids** — Wikipedia list-index, arXiv version-suffix → duplicate
    raw_items. → headline-hash id; strip `v\d+`.
13. **TheSportsDB starved the 2nd sport** (`.flat().slice()`). → round-robin
    interleave before the cap.
14. **`remember` counted against the daily quota** (`forget` didn't). → free command.
15. **`claim` single-claim guard was check-then-act (TOCTOU).** → guard in the
    UPDATE `WHERE`.
16. **Empty representative vector persisted as `[]`** (permanently unmatchable). →
    skip `putVector` on an empty vector.
17. **`/prefs minutes N` skipped the max clamp.** → clamp via `normalizeMinutes`.

**Deferred + documented** (risk/complexity out of proportion this cycle):
prompt-injection fencing of decision prompts; within-tick corroboration
double-count; session/limiter Map eviction; byte-vs-char size cap; cosine
dimension-drift guard; score-breakdown reconciliation vocabulary.

**Result:** typecheck + 427 tests (+20 new) + verify:bot green; deployed; final
wipe so the live DB now regenerates only fixed-code data.

---

## Where things stand
Two cycles, two ADRs, ~25 verified defects fixed (5 high-severity in cycle 2
alone: XSS, data-loss, two stale-data sources, quota bypass). Referential
integrity has been perfect throughout. Cycle 2's audit surfaced a fresh, larger
class of latent issues, so the problem count has **not** plateaued — a cycle 3 is
warranted when desired (see `reports/HOW-TO-RUN-A-CYCLE.md`). Strategy for making
this a competition-winning project: `reports/NEXT-STEPS.md`.

---

## Upgrade pass — ADR-0050 (2026-07-07, post-cycle-2)

Not a QA cycle — a product/demo push (UX + messaging + prompts + selected
NEXT-STEPS), planned by direct reasoning and grounded in prompt-engineering
research. 18 commits; 431 tests + verify:bot + extended harness all green; live.

- **Prompts** (research-grounded: short, role→task→format→example→fenced-source-last,
  low temperature): rewrote `analyze` (feeds brief + deep-dive) and `narrate`
  (podcast, anchor persona + spoken-audio rules); fenced all feed text as data —
  which also closes the prompt-injection gap (NEXT P2#6). Added `temperature` to
  the transport seam.
- **Web UI/UX:** brief/outline now render as story cards (not a `<pre>` blob),
  podcast as clean prose; score rationale tags always-visible + top breakdown
  auto-opens; how-it-works shows "20+ official APIs · zero scraping · updated Nm
  ago"; a **"what changed since last update" editor's note** (new entrants since
  the latest tick, client-side from `firstSeenAt`).
- **Messaging:** clearer bot HELP (each capability = plain-English example + slash
  alias + buttons); limit/error messages say when they reset and what's still free.
- **NEXT-STEPS:** web podcast enabled (script-only, minute-capped; global web cap
  is a documented follow-up); session + rate-limiter Maps evict idle/expired
  entries; server + viewer-render surface tests; stale doc counts fixed
  (431 tests / 50 ADRs; deploy = Oracle VM). Demo script + judge one-pager in
  `reports/DEMO-SCRIPT.md`.
- **Deliberately not done** (per instruction): pre-seed a warm demo DB; Priority-3
  features other than the editor's note. **Deferred + documented:** headless-browser
  viewer test (heavy dep); global web-podcast cap; within-tick corroboration
  double-count; remaining ADR-0049 low residuals.

Final wipe done post-ship, so the live DB regenerates only new-code data.
