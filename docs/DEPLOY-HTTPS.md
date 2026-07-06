# Turn on HTTPS for free (so the login cookie is `Secure`)

Right now the site is served at `http://<vm-ip>:3000` — **plain, unencrypted HTTP
to a bare IP**. The login session cookie therefore can't be marked `Secure`
(a `Secure` cookie is silently dropped over http, which would break login), so it
travels in the clear. This guide fixes that with **$0 of cost**:

- a **free domain** from [DuckDNS](https://www.duckdns.org) (e.g. `horizon.duckdns.org`), and
- **free, automatic HTTPS** via [Caddy](https://caddyserver.com), which fetches and
  renews a Let's Encrypt certificate for you.

You need a domain because certificate authorities won't issue a cert for a raw IP —
only for a name. Everything below is free and stays free.

> **What I (the code side) already did for you:** added a `Caddyfile`, a
> `docker-compose.tls.yml` overlay that runs Caddy in front of the app, and an
> env-driven `WEB_SECURE_COOKIE` switch. You only have to do the account/server
> steps below (register a name, point DNS, open ports, run the compose command) —
> those need access to your DuckDNS account and your VM, which I can't touch.

---

## 1. Get a free domain (DuckDNS)

1. Go to <https://www.duckdns.org> and sign in (GitHub/Google — free, no card).
2. Pick a subdomain, e.g. `horizon` → you get **`horizon.duckdns.org`**.
3. In the DuckDNS box, set the **current IP** to your VM's **public IP** and click
   **update**. (This creates the DNS `A` record pointing the name at your VM.)

Verify from your laptop that the name resolves to your VM's IP:

```bash
nslookup horizon.duckdns.org      # should show your VM's public IP
```

## 2. Open ports 80 and 443 on the VM

HTTPS uses 443, and Let's Encrypt validates over 80. On Oracle Cloud, open both in
**two** places (same as you did for 3000 — see `docs/DEPLOY-ORACLE-CLOUD.md`):

1. **VCN Security List → Add Ingress Rule** for `0.0.0.0/0`, TCP, ports **80** and **443**.
2. **Host firewall** on the VM:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Add the two settings to `.env` on the VM

```bash
cd ~/real-news
cat >> .env <<'EOF'
HORIZON_DOMAIN=horizon.duckdns.org
WEB_SECURE_COOKIE=true
EOF
```

- `HORIZON_DOMAIN` tells Caddy which name to serve and get a cert for.
- `WEB_SECURE_COOKIE=true` flips the login cookie to `Secure` (safe now that you're on HTTPS).

## 4. Start the app **with** the Caddy proxy

Pull the latest code, then bring it up with both compose files:

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
docker compose logs -f caddy      # watch it obtain the certificate (a few seconds)
```

Caddy grabs the Let's Encrypt certificate on the first request and renews it
automatically forever. Visit **`https://horizon.duckdns.org`** — you should see the
padlock, and login now sends a fully-`Secure` cookie.

> After this, you can **close port 3000** in the firewall so all traffic goes
> through HTTPS (Caddy reaches the app over the internal Docker network). Optional
> but tidier.

## 5. Updating later

Same as before, just keep both `-f` flags:

```bash
cd ~/real-news && git pull
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

---

## Notes

- **Cost: $0.** DuckDNS, Let's Encrypt, and Caddy are all free; your Oracle VM is
  Always Free. No credit card, no renewals to remember.
- **Own a real domain instead?** (e.g. a `.com`) — point its `A` record at the VM
  and set `HORIZON_DOMAIN` to it. Everything else is identical. A custom domain
  costs a few dollars/year at a registrar, but DuckDNS is genuinely free forever.
- **Rollback:** to go back to plain http, start with only the base file
  (`docker compose up -d`) and remove the two `.env` lines. Login keeps working.
- Background on the cookie decision: `docs/adr/0046-web-session-security-hardening.md`.
