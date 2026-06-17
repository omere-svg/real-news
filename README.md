# 🌅 Project Horizon

An autonomous, server-side **executive editor**. A background worker pulls from official
public APIs every *X* minutes, scores and de-duplicates stories into a local database, and
serves a zero-latency, read-only viewer of the pre-digested intelligence.

Built grill → architecture → TDD. Design decisions live in [`docs/adr/`](docs/adr); the
domain language lives in [`CONTEXT.md`](CONTEXT.md).

## What it does

1. **Extraction worker** — pulls from **13 public APIs/feeds** behind one `SourceAdapter`
   contract (Hacker News, arXiv, GDELT, Knesset bills, SEC EDGAR, Wikipedia, Guardian, Times
   of Israel, Knesset Votes, HF Daily Papers, NBER, Nature, PsyArXiv) with per-source health
   checks so a dead endpoint never crashes the loop.
2. **Two-tier cache** — `raw_items` (idempotent provenance) → `stories` (finalized, scored,
   classified) + `membership` (corroboration), in SQLite; plus `story_vectors` (cross-tick
   dedup) and `chat_preferences` / `usage` (the bot).
3. **Reasoning loop** — classify (Region/Topic) → embed → cluster → **resolve** (cross-tick
   merge) → score (0–10 from verifiable signals + bounded LLM nudge) → "why it matters" →
   upsert. Runs every tick.
4. **Presentation** — a read-only web viewer/JSON API **and** a Telegram bot deliver
   time-budgeted briefs, topic outlines, and podcast audio from the pre-digested cache.

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
- **Without it** — runs anyway: real Hacker News stories, real 0–10 signal scores, region
  defaults to World / topic to Other, "why it matters" left blank.

```bash
npm test         # the whole engine
npm run typecheck
```

## Telegram bot (ADR-0019/0020)

A second read-only surface over the same cache: time-budgeted briefs, topic outlines, and
**podcast audio** in chat, with per-chat preferences.

```bash
# 1. Create a bot with @BotFather, copy the token into .env:
#    TELEGRAM_BOT_TOKEN=123456:ABC...
# 2. Enable it in config/horizon.yaml:  telegram.enabled: true
npm start
```

Then message your bot: `/start`, `/brief 3`, `/outline AI`, `/podcast 1`, `/prefs topics
AI,Geopolitics`. Podcast audio needs `OPENAI_API_KEY` (TTS); without it the script is sent as
text. Restrict who can use the bot with `telegram.allowedChatIds`.

**End-to-end check (no Telegram token needed):** `npm run verify:bot` drives the real bot
through a stub transport against the real query engine + OpenAI TTS, prints every reply, and
writes the podcast to `/tmp/horizon-podcast.mp3`.

### Security & cost controls (ADR-0022/0023)

- **Default-deny access:** the bot answers no one until you list `telegram.allowedChatIds`
  (or set `telegram.openAccess: true`).
- **Rate limits + daily quotas** (`telegram.limits`): per-chat burst (`perMinute`), per-chat
  daily caps (`podcastPerDay`, `commandsPerDay`), and a process-wide `globalPodcastPerDay`
  ceiling. The podcast path (LLM + TTS) is the only user-driven OpenAI cost; quotas are
  persisted so a restart can't reset them.
- **`minutes` is clamped** to `presentation.maxMinutes`, and the LLM-backed web
  `/api/podcast` is **off by default** (`presentation.webPodcastEnabled`). The server binds
  to localhost unless you set `HOST`.

## Configuration

Structured config is [`config/horizon.yaml`](config/horizon.yaml) (validated by Zod at
boot). Secrets and deploy knobs come from the environment:

| Env var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI reasoning tiers, embeddings, and TTS (optional; ADR-0012/0018/0020) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot, when `telegram.enabled` (ADR-0019) |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; localhost by default, `0.0.0.0` to expose (ADR-0023) |
| `DB_URL` | `file:./data/horizon.db` | SQLite file, or a Turso `libsql://…` URL |
| `DB_AUTH_TOKEN` | — | Turso auth token (with a remote `DB_URL`) |
| `HORIZON_CONFIG` | `config/horizon.yaml` | Config file path |

## API

- `GET /api/stories?region=World&topic=AI&minSignificance=5&limit=20` → `{ stories: [...] }`
- `GET /api/brief?minutes=3&topic=AI` → `{ brief }` (deterministic, time-budgeted)
- `GET /api/outline?topic=AI&minutes=5` → `{ outline }`
- `GET /api/podcast?minutes=3` → `{ script }` — **off by default** (`presentation.webPodcastEnabled`, ADR-0023)
- `GET /health` → `{ ok: true }`

## Deploy (public URL)

The worker is a long-lived process with a local DB, so deploy it as a service (not
serverless). Because it uses **libsql**, the DB can be a hosted **Turso** database — so the
service disk can be ephemeral.

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

The vision is essentially complete. Remaining scope (see [`docs/ROADMAP.md`](docs/ROADMAP.md)):

- **Numeric Signal sources + the Story/Signal split** (ADR-0021 §2) — Wikipedia Pageviews
  (attention) and World Bank (macro) feeding significance as context, not stories. The only
  remaining MVP source gap.
- **Productionize** (Phase 5) — deploy (Turso + host), observability (persist `TickReport`,
  metrics), GDELT rate-limit pacing.

`data.gov.il` stays disabled (datasets, not events); other probed sources are PARKed in
[`docs/research/`](docs/research) as future reference.
