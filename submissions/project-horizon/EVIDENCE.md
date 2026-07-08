# Evidence index — Project Horizon

Curated, highest-value proof. Everything here is reproducible from a clean clone;
the live URLs prove it runs unattended. The judged tree is `main` as pushed
(see `PINNED-COMMIT.md` for how to pin and archive it).

## Demonstrated (run it / hit it)
- **The test suite — strongest evidence.** From the repo root:
  ```
  npm install
  npm test              # the printed count is the proof (749 green + 2 env-gated live, 91 files, ~3s, real migrations)
  npm run test:coverage # 96.3% lines / 85.83% branches — CI gates the pipeline at 90/80
  npm run typecheck  # clean
  npm run lint       # clean
  npm run verify:bot # drives the real Telegram bot end-to-end
  ```
  Worth opening (named, so a judge can go straight there):
  - `test/pipeline/reflection-loop.test.ts` — end-to-end integration test that
    drives the full agentic loop observably: fake-reflect → screen → apply →
    next tick shows the changed behavior (not just that a function returns
    the right shape).
  - `test/llm/url-guard.test.ts` — adversarial bypass attempts against the URL
    output guard (root-path smuggling, query/fragment tricks, host confusion) —
    all closed.
  - `test/llm/reasoner-injection.test.ts` — adversarial payloads run through
    every LLM prompt path.
  - `test/telegram/chat-agent.test.ts` — the chat agent's tool budgets
    (3/turn, 8/trajectory), scripted multi-step trajectories, the recorded
    plan step, and the agent's memory loop.
  - `test/pipeline/reflection-policy.test.ts` (the model-proposes /
    guard-disposes screen), `test/pipeline/resolve.test.ts` (cross-outlet merges).
  - `test/pipeline/maintenance.test.ts` — the *real* Reasoner over a fake
    transport driving reflection→action, plus the deterministic auto-revert
    that clears overrides after N healthy ticks (ADR-0061).
  - `test/pipeline/tick-e2e.test.ts` — two-tick end-to-end: entity-relaxed
    cross-outlet merge + corroboration scoring, and a poisoned-feed red-team
    run proving hostile input never reaches the DB (ADR-0065).
  - `test/llm/spend-guard.test.ts` — the restart-safe daily USD ceiling on the
    unattended pipeline (baseline seed, UTC rollover, cap exhaustion; ADR-0062).
  - `test/llm/chat-agent.live.test.ts` — env-gated golden test that runs the
    real tool loop against the live OpenAI API (set `OPENAI_API_KEY`).
- **Live URLs (public, no login needed to read):**
  - Viewer: https://horizon-news.duckdns.org — ranked 0–10 stories, "Why this
    score?" breakdowns, time slider, editor's note.
  - Ops: https://horizon-news.duckdns.org/dashboard — autonomous tick health,
    reflections **and the actions they imposed**, accumulation stats.
  - Agent receipts: https://horizon-news.duckdns.org/api/chat-traces — the chat
    agent's tool trajectories, per answer.
  - Accumulation: https://horizon-news.duckdns.org/api/stats — stories,
    multi-source merges, cross-tick developments, signal-history depth, today's
    per-tier token spend.
  - Raw run log: https://horizon-news.duckdns.org/api/ticks
- **Try the agent:** https://t.me/OmerNewsBot — ask "why did markets drop?", then
  open `/api/chat-traces` and watch how it answered. `/subscribe 08:00` for the
  scheduled brief.
- **Cross-outlet corroboration, judge-runnable:** `/api/brief` returns the
  structured `stories` twin — each carries a `corroboration` count (distinct
  sources) and the score `drivers` — so a judge can see multi-source stories
  and their breakdown without any private endpoint:
  ```
  curl -s "https://horizon-news.duckdns.org/api/brief?minutes=30" \
    | jq '[.stories[] | select(.corroboration > 1) | {title, corroboration, drivers}]'
  ```
  **Expectation note:** the brief is a time-boxed selection, so multi-source
  hits are a minority by construction — expect single digits, especially shortly
  after a production reset (multi-source status accrues across ticks as
  corroborating coverage arrives). The more meaningful trend is the running
  `multiSourceStories` counter on `/api/stats`, which climbs over the
  deployment's lifetime rather than a single-query snapshot:
  ```
  curl -s "https://horizon-news.duckdns.org/api/stats" | jq '{stories, multiSourceStories}'
  ```
- **Second-tenant boot demo (multi-tenancy, judge-runnable):** the config path
  and DB are both env-driven (`src/main.ts`: `HORIZON_CONFIG` env var, default
  `config/horizon.yaml`; `DB_URL` env var, default `file:./data/horizon.db`).
  A second, independent tenant is a second config + a second file-backed DB —
  no code change:
  ```
  HORIZON_CONFIG=config/alt.yaml DB_URL=file:./data/horizon-alt.db npm start
  ```
  `config/alt.yaml` (new, minimal) enables just two keyless sources
  (`hackernews`, `wikipedia`) against a separate SQLite file, so it boots fast
  and needs no API keys. On boot it validates against the same
  `src/config/schema.ts`, runs its own migrations against
  `data/horizon-alt.db`, and ticks independently of the primary instance —
  demonstrating the config/DB seam is a real tenant boundary, not just an
  env-var label.

## Source terms — programmatic-use posture

Every enabled Source (`config/horizon.yaml`) is either a documented public API
or a public RSS/XML feed; none require scraping HTML or authentication beyond
an optional free demo key. Where an outlet's exact terms-of-service text
couldn't be independently re-verified for this pass, the note below says so
plainly rather than asserting a license we haven't read line-by-line.

**Story sources (21 enabled; `knesset-votes` is defined but disabled — its upstream feed froze in 2021, ADR-0049):**

| Source | API | Terms posture |
|---|---|---|
| hackernews | Hacker News Firebase API | Public read-only API, no key required, intended for programmatic polling. |
| arxiv | arXiv API (`export.arxiv.org`) | Public API, no key required; arXiv's API is explicitly published for automated/programmatic use, rate-limited by policy. |
| gdelt | GDELT DOC 2.0 API | Public API, no key required; GDELT publishes the API for open programmatic use, rate-limited (this codebase enforces its documented 1 req/5s limit). |
| knesset | Knesset OData (`ParliamentInfo.svc`) | Israeli government open-data OData service, public, no key required. |
| secedgar | SEC EDGAR full-text search API | Public API, no key required; SEC publishes a fair-access rate-limit policy for automated access. |
| wikipedia | Wikimedia REST API (featured-feed) | Public API, no key required; Wikimedia's REST API terms permit programmatic use with a User-Agent and rate limits. |
| guardian | The Guardian world-section RSS feed | Public RSS feed, no key required; RSS syndication is published for automated consumption. |
| timesofisrael | Times of Israel RSS feed | Public RSS feed, no key required. |
| bbc-world | BBC News World RSS feed | Public RSS feed, no key required (ADR-0059). |
| bbc-business | BBC News Business RSS feed | Public RSS feed, no key required (ADR-0059). |
| bbc-sport | BBC Sport RSS feed | Public RSS feed, no key required (ADR-0059). |
| ynetnews | Ynetnews RSS feed | Public RSS feed, no key required (ADR-0059). |
| hf-papers | Hugging Face Daily Papers API | Public API, no key required. |
| nber | NBER new-papers RSS feed | Public RSS feed, no key required. |
| nature | Nature.com RSS feed | Public RSS feed, no key required. |
| psyarxiv | OSF preprints API (`api.osf.io`) | Public API, no key required; OSF publishes the API for programmatic access. |
| thesportsdb | TheSportsDB v1 API | Public API, uses TheSportsDB's published free "demo" key (`3`), rate-limited at that tier. |
| who-outbreaks | WHO Disease Outbreak News API | Public API, no key required; WHO open-data posture. |
| nasa-eonet | NASA EONET v3 API | Public API, no key required — part of NASA's open-data program. |
| usgs-quakes | USGS earthquake GeoJSON feed | Public API, no key required — part of USGS's open-data program. |
| gdacs | GDACS RSS/XML feed | Public feed, no key required. |

**Signal sources (6):**

| Source | API | Terms posture |
|---|---|---|
| wikipedia-pageviews | Wikimedia REST pageviews API | Public API, no key required, same posture as `wikipedia` above. |
| worldbank | World Bank API v2 | Public API, no key required; World Bank publishes its data/API under an open-reuse posture. |
| coingecko | CoinGecko public API v3 | Public API, no key required at the free tier, rate-limited. |
| frankfurter | Frankfurter FX API | Public API, no key required; built on open (ECB) reference data. |
| openalex | OpenAlex API | Public API, no key required (a "polite pool" with an email header is recommended, not required); OpenAlex data is published open/CC0-style. |
| gdelt-signal | GDELT DOC 2.0 API (tone timeline) | Same posture as `gdelt` above; same rate-limit exposure (see the tick-400 note below — GDELT's 429s are handled with retry). |

## Live artifacts (captured samples, in this folder)

- `stats.sample.json` — captured 2026-07-07 (post-deploy of the pinned commit)
  via `curl -s https://horizon-news.duckdns.org/api/stats`. Proves live
  accumulation since the day's reset: 581 stories, 33 multi-source stories,
  490 stories updated across ticks, 10,539 signal observations, 6 ticks
  recorded, and today's per-tier token spend (cheap/deep/embed split, plus TTS
  characters) — the exact fields the moat and cost-ceiling claims rest on.
- `tick-report.sample.json` — captured the same minute via
  `curl -s "https://horizon-news.duckdns.org/api/ticks?limit=3"`. Proves two
  things at once. **Per-source isolation is live in production**: the most
  recent full tick upserted 302 stories with `ok:true` even though `gdelt`
  returned a 429, `gdelt-signal` returned a 429, and `timesofisrael` was
  skipped that tick — a failing source no longer takes the tick down. And the
  **cross-process lock** is live: the newest entry is a `tick skipped: lock held
  by another process` (still `ok:true`), exactly the single-writer guard that
  keeps two instances off one DB.
- `chat-traces.sample.json` — **not exported**. `/api/chat-traces` is empty on
  the currently deployed build until the new build ships and someone chats
  with the bot; exporting an empty array would misrepresent what the feature
  produces. To generate one: message https://t.me/OmerNewsBot with a question
  (e.g. "why did markets drop?"), then open
  `https://horizon-news.duckdns.org/api/chat-traces`. The resulting trace now
  includes the agent's recorded one-line plan as **step 0** (the
  plan→act→observe loop is now literally inspectable, not just implied by the
  tool calls) and each trace is marked with a `path` field — `'agent'` when
  the tool loop answered, `'fallback'` when it didn't — so a judge can see
  which path served any given answer.

## Present (code to read)
- **Repo:** https://github.com/omere-svg/real-news (public; secrets stripped —
  only `.env.example` is committed).
- Key files:
  - `src/telegram/chat-agent.ts` — the model-driven tool loop (the chat agent).
  - `src/pipeline/reflection-policy.ts` — reflection→action, screened + clamped.
  - `src/pipeline/adaptive-backoff.ts` — observe→adapt, rehydrated across deploys.
  - `src/llm/fence.ts` + `src/llm/reasoner.ts` — universal injection fencing + the spoken-URL guard on narration (ADR-0065).
  - `src/llm/url-guard.ts` — the rewritten URL output guard (host/path/query/fragment closed).
  - `src/llm/spend-guard.ts` — the restart-safe daily USD ceiling on the pipeline (ADR-0062).
  - `src/pipeline/maintenance.ts` — reflection + deterministic auto-revert (ADR-0061).
  - `src/telegram/quota-guard.ts` — per-chat + global cost caps.
  - `src/presentation/score-explanation.ts` — the transparent scoring seam (breakdown restored on web, ADR-0064).
  - `docs/adr/` — architecture decision records (66 after this pass).
- **Depth artifacts (`reports/` in the repo):** `DEMO-SCRIPT.md` (3-minute path),
  `CODE-REVIEW.md`, `CYCLE-CHANGES.md` (what each QA cycle found and fixed).

## Open items — stated honestly
- **Demo video (3-minute walkthrough):**
  https://drive.google.com/file/d/1Lm2g9qdLFzy0hT-9YNa6axS1cd2ZjTL1/view?usp=sharing —
  follows the path scripted in `reports/DEMO-SCRIPT.md`.
- **`/api/chat-traces` and `/api/reflection` are empty on the current
  production deploy** until the new build ships and real usage happens. They
  populate as people chat with the bot / as ticks accumulate — see the
  "how to generate one" note above rather than a claim about what they show
  right now.
- **The production `SERVER_ERROR: HTTP status 400` incident is unconfirmed at
  the root cause.** A transient failure was observed; this pass shipped
  defensive hardening (the non-finite signal guard) and per-source isolation
  is now demonstrably live (see `tick-report.sample.json`: recent ticks show
  individual source failures with the tick itself still `ok:true`).
- **No external users yet.** `subscribers` / `questionsAnswered` on
  `/api/stats` are real counters, but they reflect internal testing traffic
  so far, not outside adoption.

## A note on live numbers
The production DB was not wiped for this pass — `stats.sample.json` reflects
accumulation from 2026-07-07 morning forward. Signal history and
corroboration timing are time-series data that cannot be backfilled, which is
exactly the moat claim: watch them grow.
