# Deploy to Render (free, push-to-deploy)

The free, git-push path for Project Horizon (ADR-0031 research). Every push to
`main` auto-redeploys. Zero app code change — it uses the existing `Dockerfile`,
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
the API at `/api/stories`.

## Limits / caveats (free tier)

- **512 MB RAM, shared CPU** — fine for this app (embeddings/LLM are remote API
  calls, not local), but heavy ticks are slower.
- **Cold start ~1 min** if a keep-alive ping is ever missed; the next boot re-runs
  a tick, so no data is lost (Turso persists everything).
- For rock-solid always-on with no ping hack, move to Render's paid instance
  (~$7/mo) or the Oracle Cloud + Coolify free-VM path.
