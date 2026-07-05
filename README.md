# 🌅 Project Horizon

An autonomous, server-side **executive editor**. A background worker pulls from official
public APIs every *X* minutes, scores and de-duplicates stories into a local database, and
serves a zero-latency, read-only viewer of the pre-digested intelligence.

Built grill → architecture → TDD. Design decisions live in [`docs/adr/`](docs/adr); the
domain language lives in [`CONTEXT.md`](CONTEXT.md).

## What it does

1. **Extraction worker** — pulls from **18 Story APIs/feeds** behind one `SourceAdapter`
   contract (Hacker News, arXiv, GDELT, Knesset bills, SEC EDGAR, Wikipedia, Guardian, Times
   of Israel, Knesset Votes, HF Daily Papers, NBER, Nature, PsyArXiv, plus TheSportsDB→Sports,
   WHO Outbreaks→Health, and NASA EONET / USGS / GDACS→Climate — ADR-0031) plus **5 numeric
   Signal sources** behind a sibling `SignalSource` seam (Wikipedia Pageviews attention, World
   Bank macro — ADR-0025; CoinGecko + Frankfurter FX → Business, OpenAlex → Science — ADR-0031),
   with per-source health checks so a dead endpoint never crashes the loop.
2. **Two-tier cache** — `raw_items` (idempotent provenance) → `stories` (finalized, scored,
   classified) + `membership` (corroboration), in SQLite; plus `story_vectors` (cross-tick
   dedup) and `chat_preferences` / `usage` (the bot).
3. **Reasoning loop** — classify (Topic) → embed → cluster → **resolve** (cross-tick
   merge) → score (0–10, **impact-first**: real-world impact + corroboration + source authority,
   with social popularity only a bounded booster + a bounded numeric-Signal nudge — ADR-0034) → factual **summary** + **"why it matters"** → upsert.
   Runs every tick.
4. **Presentation** — a read-only web viewer/JSON API **and** a Telegram bot deliver
   time-budgeted briefs, topic outlines, podcast audio, and chat about the news from the
   pre-digested cache.

Tiered OpenAI (gpt-4o-mini + gpt-4o) does the reasoning, embeddings, and TTS; **if no API key
is set, the loop degrades gracefully** — real data + signal scoring, no AI enrichment.
Full status in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Run it locally

```bash
npm install
cp .env.example .env          # add your OPENAI_API_KEY (optional — see below)
npm start
```

Open **http://localhost:3000**. The first tick runs on boot, then every
`tickIntervalMinutes` (see [`config/horizon.yaml`](config/horizon.yaml)).

- **With `OPENAI_API_KEY`** — full quality: AI classification, dedup confirmation, and
  "why it matters" analysis.
- **Without it** — runs anyway: real Hacker News stories, real 0–10 signal scores, topic
  defaults to Other, summary and "why it matters" left blank.

```bash
npm test         # the whole engine
npm run typecheck
```

## Telegram bot (ADR-0019/0020/0028/0029/0030)

A second read-only surface over the same cache: time-budgeted briefs, topic outlines,
**podcast audio**, and **chat about the news**, with per-chat preferences and memory.

```bash
# 1. Create a bot with @BotFather, copy the token into .env:
#    TELEGRAM_BOT_TOKEN=123456:ABC...
# 2. Enable it in config/horizon.yaml:  telegram.enabled: true
npm start
```

**Just talk to it (ADR-0030).** Plain English and tap-to-run buttons are the primary UX — the
Reasoner routes free text ("what's new in AI?", "make it shorter") to the right action, and
`/start` surfaces inline menus. Slash commands still work as aliases: `/brief 3`, `/outline AI`,
`/podcast 1`, `/chat <question>`, `/prefs topics AI,Geopolitics`, `/remember <note>`, `/forget`.
Podcast audio needs `OPENAI_API_KEY` (TTS); without it the script is sent as text. Restrict who
can use the bot with `telegram.allowedChatIds`.

**Chat about the news (ADR-0029):** ask a question and the bot answers from the cached Stories,
telling you when it couldn't. An optional **web-search fallback** (Tavily) kicks in only when the
cache can't answer and only when configured — `telegram.chat.webSearch.provider: tavily` plus a
`TAVILY_API_KEY`; it's `none` (cache-only) by default.

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
  user-driven OpenAI costs are the **podcast** (LLM + TTS) and **chat** (deep tier) paths — text
  briefs/outlines and the whole web viewer are deterministic cache reads that spend **zero** tokens.
- **`minutes` is clamped** to `presentation.maxMinutes`, with a **tighter
  `presentation.maxPodcastMinutes`** cap on the expensive audio path; the LLM-backed web
  `/api/podcast` is **off by default** (`presentation.webPodcastEnabled`). The server binds
  to localhost unless you set `HOST`.

## Configuration

Structured config is [`config/horizon.yaml`](config/horizon.yaml) (validated by Zod at
boot). Secrets and deploy knobs come from the environment:

| Env var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI reasoning tiers, embeddings, and TTS (optional; ADR-0012/0018/0020) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot, when `telegram.enabled` (ADR-0019) |
| `TAVILY_API_KEY` | — | Chat web-search fallback, when `telegram.chat.webSearch.provider: tavily` (ADR-0029) |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; localhost by default, `0.0.0.0` to expose (ADR-0023) |
| `DB_URL` | `file:./data/horizon.db` | SQLite file, or a Turso `libsql://…` URL |
| `DB_AUTH_TOKEN` | — | Turso auth token (with a remote `DB_URL`) |
| `HORIZON_CONFIG` | `config/horizon.yaml` | Config file path |

## API

- `GET /api/stories?topic=AI&minSignificance=5&limit=20` → `{ stories: [...] }`
- `GET /api/brief?minutes=3&topic=AI` → `{ brief }` (deterministic, time-budgeted)
- `GET /api/outline?topic=AI&minutes=5` → `{ outline }`
- `GET /api/podcast?minutes=3` → `{ script }` — **off by default** (`presentation.webPodcastEnabled`, ADR-0023)
- `GET /api/ticks?limit=50` → `{ ticks: [...] }` — recent tick outcomes (ADR-0033)
- `GET /dashboard` → HTML ops dashboard: tick health, throughput, failing sources (ADR-0033)
- `GET /health` → `{ ok: true }`

## Deploy (public URL)

**Status: live in production** on **Render** (free tier) with a hosted **Turso** (libsql)
database — push-to-`main` auto-redeploys via [`render.yaml`](render.yaml). Full walkthrough:
[`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md).

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
3. Open the service URL — the viewer is at `/`, the API at `/api/stories`.

Locally with Docker:

```bash
docker build -t horizon .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-... horizon
```

## What's left

**Everything planned is built, tested, and live in production.** All source types and the full
reasoning/presentation stack ship, deployed on Render + Turso (ADR-0031); every Story carries an
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

Optional further deepening (not on the critical path — see [`docs/ROADMAP.md`](docs/ROADMAP.md)):
GDELT signal enrichment (ADR-0032 note), a retention prune / LLM-reflection
advisor over `tick_reports` (ADR-0033), and semantic retrieval over `story_vectors` for chat.

Possible deepening (not MVP): entity-link Wikipedia Pageviews to individual clusters (today
the attention nudge is partition-level, ADR-0025); persist Signal history for trend signals.
`data.gov.il` stays disabled (datasets, not events); other probed sources are PARKed in
[`docs/research/`](docs/research) as future reference.
