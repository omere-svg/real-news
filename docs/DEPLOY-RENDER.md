# Deploy to Render (free, push-to-deploy)

> **⚠️ Bandwidth cap.** Render's free *Hobby* workspace includes only **5 GB/month of outbound
> bandwidth** and **suspends the whole workspace** when exceeded — a 24/7 worker (per-tick Turso
> vector sync + Telegram long-poll) burns that over a month. For an always-on deploy with no sleep
> and no bandwidth cap, prefer the **[Oracle Cloud always-free VM path](DEPLOY-ORACLE-CLOUD.md)**.
> To stay on Render, either add a card (overage $0.15/GB) or reduce egress (e.g. `embedder.dimensions`
> 1536 → 512 to shrink the vector sync).

> The Telegram bot is **open to everyone** (`telegram.openAccess: true`); spend is bounded by the
> per-user and total daily quotas in `config/horizon.yaml` (`telegram.limits`).

The free, git-push path for Project Horizon (ADR-0031). Every push to `main`
auto-redeploys. Zero app code change — it uses the existing `Dockerfile`,
the `/health` route, and the built-in Turso/libsql support.

> **Why a keep-alive is needed.** Render's *free* web service spins down after
> 15 minutes with no inbound traffic. Project Horizon is a long-lived worker (the
> tick loop + Telegram long-poll run in-process), so a sleeping instance stops
> fetching news. Step 4 keeps it awake. (For a truly always-on free host with no
> hack, see the Oracle Cloud + Coolify option in the chat research.)

## 1. Database — Turso (free, persistent)

Render's free disk is **ephemeral**, so don't use a local SQLite file. Create a
free Turso DB and grab its URL + token:

```bash
# https://turso.tech — free tier is generous (multiple DBs, GBs, 1B row reads/mo)
turso db create horizon
turso db show horizon --url        # → libsql://horizon-<org>.turso.io   (DB_URL)
turso db tokens create horizon     # → eyJhbGc…                          (DB_AUTH_TOKEN)
```

Migrations run automatically on boot (`migrate()` in `src/main.ts`).

## 2. Create the service

1. Push this repo to GitHub (it already is).
2. Render dashboard → **New + → Blueprint** → pick this repo. Render reads
   [`render.yaml`](../render.yaml) and provisions the `project-horizon` web service.
   (No credit card on the free plan.)

## 3. Set the secret env vars

In the service's **Environment** tab, fill the `sync: false` vars from `render.yaml`:

| Var | Value |
|---|---|
| `OPENAI_API_KEY` | your OpenAI key (omit to run without AI enrichment) |
| `TELEGRAM_BOT_TOKEN` | your BotFather token (omit to skip the bot) |
| `DB_URL` | the Turso `libsql://…` URL from step 1 |
| `DB_AUTH_TOKEN` | the Turso token from step 1 |

`HOST=0.0.0.0` is already set in the blueprint (Render must reach the app on all
interfaces; the app otherwise binds localhost). `PORT` is injected by Render.

## 4. Keep it awake (free)

Add a free uptime pinger hitting the health endpoint every ~10 minutes:

- **cron-job.org** or **UptimeRobot** → monitor `https://<your-service>.onrender.com/health`
  every 10 min. This keeps the process up so the tick loop keeps running, and stays
  within Render's free 750 instance-hours/month for a single service.

## 5. Push-to-deploy

From here, `git push origin main` rebuilds and redeploys automatically
(`autoDeploy: true`). The viewer is at `https://<your-service>.onrender.com/`,
the API at `/api/brief`.

## Troubleshooting

- **`TypeError: Invalid URL` on boot / "deploy failed"** — the `DB_URL` value is malformed.
  It must start with **`libsql://`** (not `https://`) and have **no trailing space/newline**
  (a stray newline shows up as `%0A` in the error). Re-copy it with `turso db show <db> --url`.
- **Viewer shows "no stories yet"** — either the first tick hasn't finished (give it a minute,
  or it's a free-tier cold start), or the topic filter is hiding everything: uncheck the topic
  boxes to show all topics. Confirm data exists with `GET /api/brief?minutes=5`.

## Cost controls (who can use it, and the spend ceiling)

The bot is **open to everyone** (`telegram.openAccess: true`, empty `allowedChatIds`). Spend is
capped on two axes in `telegram.limits` — **per user** (`commandsPerDay`, `podcastPerDay`,
`perMinute` burst) and **total across all users** (`globalCommandsPerDay`, `globalPodcastPerDay`).
The only token-spending paths are **podcast** and **chat questions**; the text brief and the
entire web viewer are deterministic cache reads (zero tokens). The web `/api/podcast` LLM endpoint
is on when `presentation.webPodcastEnabled: true` (ADR-0058) and reuses the same podcast budget.
Tune the numbers in `config/horizon.yaml` and push to redeploy.

## Limits / caveats (free tier)

- **512 MB RAM, shared CPU** — fine for this app (embeddings/LLM are remote API
  calls, not local), but heavy ticks are slower.
- **Cold start ~1 min** if a keep-alive ping is ever missed; the next boot re-runs
  a tick, so no data is lost (Turso persists everything).
- For rock-solid always-on with no ping hack, move to Render's paid instance
  (~$7/mo) or the Oracle Cloud + Coolify free-VM path.
