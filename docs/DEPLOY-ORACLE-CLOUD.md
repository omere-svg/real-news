# Deploy to an Oracle Cloud always-free VM (no sleep, no bandwidth cap)

> **Why move here from Render?** Render's free *Hobby* workspace caps outbound
> bandwidth at **5 GB/month** and suspends the whole workspace when you exceed it —
> which is what took Project Horizon offline. A 24/7 worker that syncs story
> vectors to Turso and long-polls Telegram burns that small allowance over a month.
>
> An Oracle Cloud **Always Free** VM fixes both problems for a long-running worker:
> it **never sleeps** (unlike free PaaS instances) and includes **10 TB/month of
> egress** — effectively unmetered for this app. Trade-off: no git-push auto-deploy,
> so updates are a manual `git pull` + rebuild (or add Coolify later, see the end).

The app is a single Dockerized Node process that talks to a hosted **Turso** DB
(keep your existing `DB_URL` + `DB_AUTH_TOKEN`), so nothing about the data layer
changes — only where the process runs.

---

## 1. Create the Always Free VM

1. Sign in at <https://cloud.oracle.com> (Always Free tier, no charge; a card may be
   requested for identity verification but Always Free resources aren't billed).
2. **Compute → Instances → Create instance.**
   - **Image:** Canonical **Ubuntu 24.04** (or 22.04).
   - **Shape:** click *Change shape* → **Ampere (ARM)** → `VM.Standard.A1.Flex`.
     Set **1 OCPU / 6 GB RAM** (well within the Always Free 4 OCPU / 24 GB ceiling).
     The image is multi-arch, so ARM is fine.
     - *If you get an "out of capacity" error* (common on ARM), retry in a bit or a
       different availability domain, or fall back to `VM.Standard.E2.1.Micro`
       (AMD, 1 GB) — tight but workable since embeddings/LLM are remote API calls.
   - **SSH keys:** upload your public key (or let Oracle generate one and download it).
3. Create it, then copy the instance's **public IP**.

## 2. (Optional) Open the viewer port

Only needed if you want to reach the web viewer/API at `http://<public-ip>:3000`.
**Skip this entirely if you only use the Telegram bot** (it works over outbound
long-poll — no inbound port required).

1. **VCN security list:** Networking → Virtual Cloud Networks → your VCN → the
   public subnet's **Security List** → **Add Ingress Rule**: Source `0.0.0.0/0`,
   IP Protocol `TCP`, Destination port `3000`.
2. **Host firewall** (Oracle Ubuntu images block non-SSH ports by default):
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
   sudo netfilter-persistent save     # persist across reboots
   ```

## 3. SSH in and install Docker

```bash
ssh ubuntu@<public-ip>

# Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"        # run docker without sudo
sudo systemctl enable --now docker     # start now AND on every reboot
exit                                   # log out/in so the group takes effect
ssh ubuntu@<public-ip>
```

## 4. Get the code and set secrets

```bash
git clone https://github.com/omere-svg/real-news.git
cd real-news

# Create the .env with your four secrets (same values you used on Render/Turso).
cat > .env <<'EOF'
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=123456:AA...
DB_URL=libsql://horizon-<org>.turso.io
DB_AUTH_TOKEN=eyJ...
EOF
chmod 600 .env
```

> Reuse the **same Turso `DB_URL`** so the VM picks up the existing database. The
> app runs migrations automatically on boot.

## 5. Run it

```bash
docker compose up -d --build
docker compose logs -f            # watch: you should see "[tick] extracted=… stories=…"
```

Verify health (if you opened the port): `curl http://localhost:3000/health` → `{"ok":true}`.
The Telegram bot starts polling automatically (it's enabled in `config/horizon.yaml`).

**Auto-restart is already handled:** `restart: unless-stopped` in
`docker-compose.yml` plus the enabled Docker service means the container comes back
after a crash or a VM reboot. No keep-alive pinger is needed — the VM never sleeps.

## 6. Updating after you push new code

```bash
cd ~/real-news
git pull
docker compose up -d --build      # rebuild + restart with the new code
```

---

## Turn off the old Render service

Once the VM is ticking, avoid double-writers to the same Turso DB:

- In the Render dashboard, **suspend/delete** the `project-horizon` service (it's
  already suspended by the bandwidth cap, so you can just leave it or delete it).
- `render.yaml` stays in the repo as a fallback deploy path; it's harmless.

## Notes / optional hardening

- **Bandwidth is no longer a concern** here, so the 1536-dim embeddings are fine to
  keep. (On a metered host you'd cut them to 512 to shrink the per-tick vector sync —
  a one-line `embedder.dimensions` change, needs a re-embed.)
- **Cost:** Always Free resources are genuinely $0. Oracle may reclaim *idle* Always
  Free VMs, but a continuously-running worker is not idle.
- **Git-push deploys (optional):** if you miss Render's auto-deploy, install
  [Coolify](https://coolify.io) on the same VM — a self-hosted, Heroku-like PaaS that
  redeploys on `git push`. Heavier setup; the plain `docker compose` flow above is
  simpler and enough for one service.
