# ADR-0046: Web-session security hardening

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Extends:** ADR-0040 (Log in with Telegram), ADR-0042 (retention).

## Context

A review of "is user data secure?" confirmed the reassuring baseline: Horizon
stores **no passwords and no emails** — identity is the Telegram `chatId`, proved
by a single-use pairing code (ADR-0040). Session tokens are 24 random bytes; the
cookie is `httpOnly` + `SameSite=Lax`; the local DB is `chmod 0600`; remote Turso
requires an auth token. Two gaps remained:

1. The session cookie was never marked `Secure`, so on the current plain-`http://`
   VM the token could be sniffed in transit.
2. Expired `web_sessions` / `link_codes` were never swept, so dead rows accrued.

## Decision

1. **Config-gated `Secure` cookie.** `web.secureCookie` (default `false`, since the
   VM serves `http://`) sets `Secure` on the session cookie. Flip it to `true`
   the moment the site is served over HTTPS so the token never travels
   unencrypted. (Left default-off rather than always-on because a `Secure` cookie
   is silently dropped over plain http, which would break login on the current
   deployment.)
2. **Prune expired auth rows.** `WebAuthRepo.pruneExpired(now)` deletes sessions
   and codes past their TTL; the tick loop calls it each tick when
   `retention.pruneExpiredAuth` is true (ADR-0042).

## Consequences

- No new PII, no new secrets — the model deliberately holds only news preferences
  keyed by a Telegram id.
- HTTPS is now a one-line config flip away from a fully-`Secure` session.
- Stale auth rows self-clean; the tables stay small.
- Follow-up (not required now): rate-limit `POST /api/auth/start` if abuse appears,
  and adopt the official Telegram Login Widget once a domain + TLS exist (ADR-0040).
