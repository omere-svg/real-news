# ADR-0049: Cycle-2 audit fixes (security, data-loss, source quality, cost)

- **Status:** Accepted — implemented 2026-07-07.
- **Date:** 2026-07-07
- **Extends:** ADR-0047/0048 (integrity & QA passes), ADR-0021/0031 (sources),
  ADR-0022/0031 (quotas), ADR-0040 (web auth), ADR-0017 (cross-tick identity).

## Context

The second QA cycle added a **deep code-audit stage**: three parallel auditor
agents (sources, presentation/bot, db/scoring/llm) plus a pipeline-core pass,
every finding re-verified at its source line — several via live endpoint probes.
The fresh-start observation was clean (0 orphans across all snapshots; the
ADR-0048 developing-story dedup held at 0 duplicate-title stories; 19/19 extended
bot checks), so the value this cycle came from the audit. Confirmed defects:

1. **Stored XSS** — the web viewer interpolated a feed-controlled story URL into
   an `<a href>` unescaped and unscheme-checked (every sibling field used `esc`).
2. **Data-loss on a transient DB error** — story `upsert` ran three separate
   statements (story write, membership DELETE incl. prior owners, membership
   INSERT); a failure between DELETE and INSERT orphaned the story, which the
   tick's `finally` `pruneOrphans` + `maintain`'s `pruneUnreferenced` then deleted
   — losing a paid deep summary and its provenance in the same tick.
3. **Two sources silently serving stale data** — SEC EDGAR full-text search
   defaults to *relevance* ranking, returning 8-Ks from 2009-2025 (verified); the
   Knesset-votes OData view is frozen (newest approved vote 2021-07-13, verified).
4. **timesofisrael / nber skipped every tick for days** — bot-manager CDNs
   (Cloudflare/Akamai) 403 the anonymous Node fetch (no User-Agent); nber returned
   403 without a UA and 200 with one (verified). The adapter also swallowed the
   status into a bare `false`, so the reason was invisible.
5. **Router LLM spend bypassed the daily quota** — plain text was routed
   (a cheap-tier call) *before* `withinQuota`, so a chat/process over its command
   cap still spent the model — defeating the ADR-0031 "global cap makes open
   access safe" guarantee.
6. **`resolve` re-fetched all recent vectors once per cluster** (~200 identical
   large Turso reads/tick) — the dominant cause of multi-minute ticks.
7. Smaller, verified: `less <topic>` un-muted a muted topic (0 → 0.25); `remember`
   wrongly counted against the daily quota (`forget` didn't); podcast TTS 400s
   above ~4096 chars yet still spent the scarce podcast quota; unstable Wikipedia
   (list-index) and arXiv (version-suffix) ids minted duplicate raw_items; a
   truthy-unparseable upstream date became `NaN` and libsql rejects a NaN bind
   (whole-tick failure); TheSportsDB's `.flat().slice()` starved the 2nd sport;
   `withRetry` stacked on the SDK's own retries (up to 9 attempts) and retried
   permanent 4xx; `claim` was check-then-act; an empty representative vector
   persisted as `[]` (permanently unmatchable); `/prefs minutes` skipped the clamp.

## Decision

Each fix behind its existing seam, test-first:

- **Web:** a client-side `safeUrl` escapes + allows only http(s); the link is
  dropped (title kept) otherwise.
- **DB integrity:** story upsert's three writes run in one `db.batch` (atomic).
- **Sources:** a default descriptive `User-Agent` on every fetch (caller wins);
  a shared `parseDateOrNull` NaN-guard across the JSON adapters; EDGAR bounded to
  a recent `startdt/enddt` window (clock-injected); stable Wikipedia id
  (headline hash, no index) and arXiv id (version stripped); TheSportsDB caps
  round-robin so later sports aren't starved; **knesset-votes disabled** in config
  (upstream frozen; reversible).
- **Bot cost/correctness:** a read-only `UsageRepo.peek` gates the router call so
  an over-quota chat never spends the model; `less` on a 0 weight stays muted;
  `remember` is a free command; TTS input is clamped to ~4000 chars at a sentence
  boundary; `/prefs minutes` clamps via `normalizeMinutes`.
- **Perf:** `resolve` fetches recent vectors once per tick (memoized by query
  key), matching in memory with the pure `bestMatch`.
- **Resilience:** `withRetry` retries only transient errors (429/5xx/network) and
  the OpenAI clients set `maxRetries: 0` so retry lives in one layer.
- **Vector store:** skip `putVector` for an empty vector.
- **Auth:** the single-claim guard moves into the UPDATE `WHERE`.

## Consequences

- The public viewer can't be XSS'd via a feed URL; a transient DB blip no longer
  destroys an accreted story; EDGAR/Knesset stop injecting stale filings/votes;
  timesofisrael/nber should return (residual risk: Cloudflare may still block the
  Oracle datacenter IP by reputation — the health-check reason is now the thing to
  watch, and knesset-votes stays off until upstream revives).
- Open-access cost is bounded again: routing respects the daily cap; TTS and retry
  no longer waste model spend.
- Ticks should be markedly faster (one vector fetch instead of ~200).
- Deferred, documented in `reports/cycle-2/REPORT.md` residuals: prompt-injection
  fencing of decision prompts, within-tick corroboration double-count, session/
  limiter Map eviction under open access, byte-vs-char response cap, cosine
  dimension-drift guard, score-breakdown reconciliation vocabulary.
