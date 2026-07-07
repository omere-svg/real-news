# 🌅 Project Horizon

An autonomous, server-side **executive editor**. It exists to solve one problem: today the
AI, geopolitics, sports, Israeli politics — and everything else you follow — live in a
dozen different apps and outlets, and any single one can bury, miss, or slant what matters.
Horizon centralizes all of it in **one objective place**, ranks each story by **real-world
importance** (not by any outlet's agenda), and reads **across many sources at once** so
nothing important slips through. Everything is presented in **English** (foreign headlines
are translated during processing — ADR-0057).

Under the hood: a background worker pulls from 20+ official public APIs every *X* minutes,
scores and corroborates stories into a local database, and serves a zero-latency, read-only
viewer of the pre-digested intelligence.

Built grill → architecture → TDD. Design decisions live in [`docs/adr/`](docs/adr); the
domain language lives in [`CONTEXT.md`](CONTEXT.md).

## What it does

1. **Extraction worker** — pulls from **18 Story APIs/feeds** behind one `SourceAdapter`
   contract (Hacker News, arXiv, GDELT, Knesset bills, SEC EDGAR, Wikipedia, Guardian, Times
   of Israel, Knesset Votes, HF Daily Papers, NBER, Nature, PsyArXiv, plus TheSportsDB→Sports,
   WHO Outbreaks→Health, and NASA EONET / USGS / GDACS→Climate — ADR-0031; `knesset-votes` is
   currently disabled because its upstream feed froze in 2021 — ADR-0049) plus **6 numeric
   Signal sources** behind a sibling `SignalSource` seam (Wikipedia Pageviews attention, World
   Bank macro — ADR-0025; CoinGecko + Frankfurter FX → Business, OpenAlex → Science — ADR-0031;
   GDELT aggregate tone → Geopolitics — ADR-0041), with per-source health checks so a dead
   endpoint never crashes the loop.
2. **Two-tier cache** — `raw_items` (idempotent provenance) → `stories` (finalized, scored,
   classified) + `membership` (corroboration), in SQLite; plus `story_vectors` (cross-tick
   dedup + semantic chat retrieval, ADR-0045), `signal_observations` (trend history, ADR-0044),
   `tick_reports` / `tick_reflections` (observability + advisories, ADR-0033/0042), and
   `chat_preferences` / `usage` / web-auth tables (the bot + web login, ADR-0040).
3. **Reasoning loop** — classify (Topic) → embed → cluster → **resolve** (cross-tick
   merge) → score (0–10, **impact-first**: real-world impact + corroboration + source authority,
   with social popularity only a bounded booster + a bounded numeric-Signal nudge — ADR-0034) → factual **summary** + **"why it matters"** → upsert.
   Runs every tick.
4. **Presentation** — a read-only web viewer/JSON API **and** a Telegram bot deliver
   time-budgeted briefs, podcast audio, and chat about the news from the
   pre-digested cache (ADR-0060: two reader formats, Brief + Podcast).

Tiered OpenAI models (configured in `config/horizon.yaml`) do the reasoning, embeddings, and TTS; **if no API key
is set, the loop degrades gracefully** — real data + signal scoring, no AI enrichment.
Full status in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Run it locally

```bash
npm install
cp .env.example .env          # add your OPENAI_API_KEY (optional — see below)
npm run build && npm start    # or: npm run start:dev (tsx, no build step)
```

Open **http://localhost:3000**. The first tick runs on boot, then every
`tickIntervalMinutes` (see [`config/horizon.yaml`](config/horizon.yaml)).

- **With `OPENAI_API_KEY`** — full quality: AI classification, dedup confirmation, and
  "why it matters" analysis.
- **Without it** — runs anyway: real Hacker News stories, real 0–10 signal scores, topic
  defaults to Other, summary and "why it matters" left blank.

```bash
npm test              # the whole engine
npm run test:coverage # same suite + coverage report (CI-gated at 90% lines / 80% branches)
npm run typecheck
```

## Telegram bot (ADR-0019/0020/0028/0029/0030)

A second read-only surface over the same cache: time-budgeted briefs, **podcast audio**,
and **chat about the news**, with per-chat preferences and memory.

```bash
# 1. Create a bot with @BotFather, copy the token into .env:
#    TELEGRAM_BOT_TOKEN=123456:ABC...
# 2. Enable it in config/horizon.yaml:  telegram.enabled: true
npm start
```

**Just talk to it (ADR-0030).** Plain English and tap-to-run buttons are the primary UX — the
Reasoner routes free text ("what's new in AI?", "make it shorter") to the right action, and
`/start` surfaces inline menus. Slash commands still work as aliases: `/brief 3`,
`/podcast 1`, `/chat <question>`, `/prefs topics AI,Geopolitics`, `/remember <note>`, `/forget`,
`/subscribe 08:00`.
Podcast audio needs `OPENAI_API_KEY` (TTS); without it the script is sent as text. Restrict who
can use the bot with `telegram.allowedChatIds`.

**Chat about the news (ADR-0029/0054):** ask a question and the bot runs a bounded **agent
loop** — the model itself chooses tools (semantic cache search, story detail, numeric signal
trends, live web search, saving your context) and iterates until it can answer, telling you
honestly when it can't. Every answer's tool trajectory is persisted and inspectable at
`/api/chat-traces`. Web search (Tavily) is offered as a tool only when configured —
`telegram.chat.webSearch.provider: tavily` plus a `TAVILY_API_KEY`; `none` (cache-only) by
default. On any agent failure the bot degrades to the fixed retrieve-then-answer path.
Conversations survive restarts (durable sessions, ADR-0054).

**Scheduled daily brief (ADR-0054):** `/subscribe 08:00` (UTC) delivers your personalized,
preference-weighted brief every morning — deterministic cache reads, zero model spend;
`/subscribe off` stops it.

**Personal memory (ADR-0028):** `/remember I'm a backend dev in Tel Aviv` keeps a free-text note
that colors narration and chat phrasing; `/forget` clears it. Memory shapes *wording*; preference
weights shape *ranking* — they're separate.

**Tune it in plain English (ADR-0026):** `/feedback more AI, less sports, keep it shorter` — the
Reasoner reads the free text and adjusts per-topic **preference weights** that bias your briefs
(mute a topic, boost another, change length). `/prefs` shows the current tuning; `/feedback undo`
reverts the last change. Significance stays objective; the weighting is yours alone, applied at
ranking time.

**End-to-end check (no Telegram token needed):** `npm run verify:bot` drives the real bot
through a stub transport against the real query engine + OpenAI TTS, prints every reply, and
writes the podcast to `/tmp/horizon-podcast.mp3`.

### Security & cost controls (ADR-0022/0023/0031)

- **Access:** the bot is **open to everyone** (`telegram.openAccess: true`, empty
  `allowedChatIds`) so anyone can use it — spend is bounded entirely by the quotas below.
  To lock it back down, list specific `telegram.allowedChatIds` (an explicit allowlist
  overrides open access).
- **Rate limits + daily quotas, both per-user and total** (`telegram.limits`): per-chat burst
  (`perMinute`), per-chat daily caps (`podcastPerDay`, `commandsPerDay`), and **two process-wide
  daily ceilings — `globalPodcastPerDay` and `globalCommandsPerDay`** — the hard total-spend
  backstops that make open access safe. Every command (including a chat question, which hits the
  LLM) counts against both the per-chat and the global command cap; podcasts additionally draw the
  podcast caps. All counters are persisted, so a restart can't reset a day's budget. The only
  user-driven OpenAI costs are the **podcast** (LLM + TTS) and **chat** (deep tier) paths — the text
  brief and the whole web viewer are deterministic cache reads that spend **zero** tokens.
- **`minutes` is clamped** to `presentation.maxMinutes`, with a **tighter
  `presentation.maxPodcastMinutes`** cap on the expensive audio path. The LLM-backed web
  `/api/podcast` is **on** (`presentation.webPodcastEnabled: true`, ADR-0050); it narrates real
  **audio** when TTS is enabled (ADR-0020/0058), degrading to script-only on failure, is bounded
  by `maxPodcastMinutes`, and is produced only on an explicit **Generate** press so a format/topic
  choice never auto-spends the model. Flip it off to make the web a pure zero-token surface. The
  server binds to localhost unless you set `HOST`.

## Configuration

Structured config is [`config/horizon.yaml`](config/horizon.yaml) (validated by Zod at
boot). Secrets and deploy knobs come from the environment:

| Env var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI reasoning tiers, embeddings, and TTS (optional; ADR-0012/0018/0020) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot, when `telegram.enabled` (ADR-0019) |
| `TELEGRAM_BOT_USERNAME` | — | Bot username (no `@`) for web deep links + the "Chat on Telegram" button (ADR-0040) |
| `WEB_SECURE_COOKIE` | config | Overrides `web.secureCookie` in either direction (`false` for plain-http local dev) |
| `TAVILY_API_KEY` | — | Chat web-search fallback, when `telegram.chat.webSearch.provider: tavily` (ADR-0029) |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; localhost by default, `0.0.0.0` to expose (ADR-0023) |
| `DB_URL` | `file:./data/horizon.db` | SQLite file, or a Turso `libsql://…` URL |
| `DB_AUTH_TOKEN` | — | Turso auth token (with a remote `DB_URL`) |
| `HORIZON_CONFIG` | `config/horizon.yaml` | Config file path |

## API

- `GET /api/brief?minutes=3&topic=AI` → `{ brief }` (deterministic, time-budgeted; `topic` repeatable to filter)
- `GET /api/podcast?minutes=3` → `{ script, audio }` — on (`presentation.webPodcastEnabled`, ADR-0050); narrates mp3 `audio` (base64) when TTS is enabled, else `audio:null` + `script` (ADR-0020/0058); `maxPodcastMinutes`-capped, shares the global podcast budget (ADR-0052)
- `GET /api/ticks?limit=50` → `{ ticks: [...] }` — recent tick outcomes (ADR-0033)
- `GET /api/reflection` → `{ reflections: [...] }` — LLM advisories + the actions they imposed (ADR-0042/0054)
- `GET /api/chat-traces` → `{ traces: [...] }` — the chat agent's tool-loop trajectories (ADR-0054)
- `GET /api/stats` → accumulation evidence: stories, multi-source stories, cross-tick developments, signal-history depth (ADR-0054)
- `GET /dashboard` → HTML ops dashboard: tick health, throughput, failing sources, reflections, accumulation strip (ADR-0033)
- `GET /health` → `{ ok: true }`

## Deploy (public URL)

Two supported paths, both with a hosted **Turso** (libsql) database (so the service disk can be
ephemeral):

- **Always-free VM — recommended for 24/7 (no sleep, no bandwidth cap); this is how the live
  instance runs:** GitHub Actions builds `dist/` in CI, ships it over scp, and restarts a
  **systemd** unit with a health-checked rollback (`.github/workflows/deploy.yml`) — the VM never
  compiles. [`docs/DEPLOY-ORACLE-CLOUD.md`](docs/DEPLOY-ORACLE-CLOUD.md) covers the initial VM
  setup; the `Dockerfile` + [`docker-compose.yml`](docker-compose.yml) remain as an alternative
  container path for any Docker host. Preferred over a free PaaS because a long-lived worker
  hits sleep + egress caps — Render's free *Hobby* workspace caps outbound bandwidth at
  5 GB/month and suspends the workspace when exceeded.
- **Render (free tier), push-to-deploy:** [`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md) via
  [`render.yaml`](render.yaml). Simplest to set up, but needs a `/health` keep-alive pinger and can
  suspend on the 5 GB bandwidth cap.

**Share the Telegram bot:** the bot is open to everyone (see cost controls above), so just send
people its link — `https://t.me/<your-bot-username>` (the `@username` you set in @BotFather).
Anyone who opens it and taps **Start** can use it immediately; per-user and total daily quotas
cap the cost.

The worker is a long-lived process, so deploy it as a service (not serverless). Because it uses
**libsql**, the DB can be a hosted **Turso** database — so the service disk can be ephemeral.

1. **Database (Turso):** create a DB, grab its `libsql://…` URL + auth token.
2. **Host (Railway / Render / Fly.io):** deploy this repo (the `Dockerfile` is ready), and set env vars:
   - `OPENAI_API_KEY` — your key
   - `DB_URL` — the Turso URL · `DB_AUTH_TOKEN` — the Turso token
3. Open the service URL — the viewer is at `/`, the API at `/api/brief`.

Locally with Docker:

```bash
docker build -t horizon .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-... horizon
```

## What's left

**Everything planned is built, tested, and live in production.** All source types and the full
reasoning/presentation stack ship, deployed on an Oracle Cloud VM + Turso (ADR-0031); every Story carries an
inspectable score breakdown ("why this score", ADR-0032); and every tick is persisted and
surfaced on a `/dashboard` health page (ADR-0033).

**Production hardening (ADR-0038)** — a review of the live DB drove a throughput/dedup/
integrity pass, tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md) §4: bounded-concurrency
ticks (~17 min → ~1.5 min) with a re-entrancy guard, orphan-Story pruning, cross-topic
cross-tick dedup, a sharper classifier (`Other` 22% → 6%, disasters ⇒ `Climate`), and
steady-state summary/why backfill. A follow-up pass (**ADR-0039**) then fixed GDELT
skipping every tick (a health-check + extract double-call tripped its 1-req/5s limit,
starving `Geopolitics`) and parallelised the enrichment backfill so the cache heals fast.
All verified end-to-end; deploys to prod on the next push to `main`.

**Web access (ADR-0040)** — an optional "Log in with Telegram" flow lets a reader open the
brief in a browser without any password or email: identity is the Telegram id, proved by a
single-use pairing code. **Security hardening (ADR-0046)** added a config-gated `Secure`
cookie and per-tick pruning of expired sessions/codes. No passwords or emails are ever stored.

**Optional deepening — all DONE (ADR-0041–0045).** The five follow-ups once listed here are
now shipped and reversible via config: GDELT signal enrichment via a `timelinetone` Signal
source (ADR-0041); a retention prune of `tick_reports` plus an LLM "reflection" advisor that
reads the last few ticks as a group (ADR-0042); semantic retrieval over `story_vectors` for
chat grounding (ADR-0045); entity-linked Wikipedia Pageviews attention down to the individual
story (ADR-0043); and persisted Signal history for trend-aware scoring (ADR-0044).

**Agentic pass (ADR-0053/0054).** The chat surface became a real bounded agent (model-driven
tool loop with persisted, public trajectories); the reflection advisor now *acts* — structured
proposals screened by a deterministic policy guard become forced source cooldowns and a
persisted deep-analysis budget the next tick consumes; adaptation state (backoff streaks,
policy, conversations) survives deploys; every untrusted prompt input is fenced with delimiter
escaping and model outputs pass grounding guards; scheduled personalized briefs ship via
`/subscribe`.

**Second integrity & resilience pass (ADR-0047).** A fresh-start run (wipe → three ticks →
use every surface → inspect all collections) drove a correctness/cost/resilience sweep: deep
summaries + "why it matters" now persist across ticks instead of being wiped by cheap
re-upserts; the two GDELT adapters share a per-host rate limiter (no more 429 every tick);
the JSON API can't be 500'd by a non-numeric param; HTML entities are decoded in summaries;
`raw_items`/`signal_observations` are kept bounded; classify/score run with bounded
concurrency and the boot backfill no longer races live ticks; the OpenAI transport + embedder
retry transient blips (so a hash vector can't poison the neural store); pairing codes are
single-claim; and chat grounds only on genuinely-relevant stories.

> **Operational rule: one writer per database.** The tick pipeline is **not** safe to run
> twice against the same DB — two writers double-count corroboration and race membership. Run
> exactly one instance per Turso database. As a backstop, `lock.enabled` (ADR-0047, on by
> default in `config/horizon.yaml`) takes a cross-process advisory lock so a stray second
> process skips its tick instead of corrupting the store.

`data.gov.il` stays disabled (datasets, not events); other probed sources are PARKed in
[`docs/research/`](docs/research) as future reference.
