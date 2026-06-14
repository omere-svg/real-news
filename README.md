# 🌅 Project Horizon

An autonomous, server-side **executive editor**. A background worker pulls from official
public APIs every *X* minutes, scores and de-duplicates stories into a local database, and
serves a zero-latency, read-only viewer of the pre-digested intelligence.

Built grill → architecture → TDD. Design decisions live in [`docs/adr/`](docs/adr); the
domain language lives in [`CONTEXT.md`](CONTEXT.md).

## What it does (Phase 1)

1. **Extraction worker** — pulls from public APIs (Hacker News today; GDELT / arXiv /
   data.gov.il share the same `SourceAdapter` contract) with per-source health checks so a
   dead endpoint never crashes the loop.
2. **Two-tier cache** — `raw_items` (idempotent provenance) → `stories` (finalized,
   scored, classified) + `membership` (corroboration signal), in SQLite.
3. **Reasoning loop** — classify (Region/Topic) → embed → cluster/dedup → score (0–10 from
   verifiable signals + bounded LLM nudge) → "why it matters" → upsert. Runs every tick.

A web UI + JSON API serve the cache. Tiered Claude (Haiku + Opus) does the reasoning;
**if no API key is set, the loop degrades gracefully** — real data + signal scoring, no AI
enrichment.

## Run it locally

```bash
npm install
cp .env.example .env          # add your ANTHROPIC_API_KEY (optional — see below)
npm start
```

Open **http://localhost:3000**. The first tick runs on boot, then every
`tickIntervalMinutes` (see [`config/horizon.yaml`](config/horizon.yaml)).

- **With `ANTHROPIC_API_KEY`** — full quality: AI classification, dedup confirmation, and
  "why it matters" analysis.
- **Without it** — runs anyway: real Hacker News stories, real 0–10 signal scores, region
  defaults to World / topic to Other, "why it matters" left blank.

```bash
npm test         # 55 tests — the whole engine
npm run typecheck
```

## Configuration

Structured config is [`config/horizon.yaml`](config/horizon.yaml) (validated by Zod at
boot). Secrets and deploy knobs come from the environment:

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables the Claude reasoning tiers (optional) |
| `PORT` | `3000` | HTTP port |
| `DB_URL` | `file:./data/horizon.db` | SQLite file, or a Turso `libsql://…` URL |
| `DB_AUTH_TOKEN` | — | Turso auth token (with a remote `DB_URL`) |
| `HORIZON_CONFIG` | `config/horizon.yaml` | Config file path |

## API

- `GET /api/stories?region=World&topic=AI&minSignificance=5&limit=20` → `{ stories: [...] }`
- `GET /health` → `{ ok: true }`

## Deploy (public URL)

The worker is a long-lived process with a local DB, so deploy it as a service (not
serverless). Because it uses **libsql**, the DB can be a hosted **Turso** database — so the
service disk can be ephemeral.

1. **Database (Turso):** create a DB, grab its `libsql://…` URL + auth token.
2. **Host (Railway / Render / Fly.io):** deploy this repo (the `Dockerfile` is ready), and set env vars:
   - `ANTHROPIC_API_KEY` — your key
   - `DB_URL` — the Turso URL · `DB_AUTH_TOKEN` — the Turso token
3. Open the service URL — the viewer is at `/`, the API at `/api/stories`.

Locally with Docker:

```bash
docker build -t horizon .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... horizon
```

## Not yet built

The other three source adapters (GDELT, arXiv, data.gov.il — same `SourceAdapter`
contract), a neural embedder (the `Embedder` seam currently uses a lightweight hashing
embedder; transformers.js is a drop-in), and the presentation layer's brief / podcast /
outline generators (`QueryEngine` stubs, [ADR-0011](docs/adr/0011-presentation-stubs-only.md)).
