# ADR-0040: Web "Log in with Telegram" — one identity, shared preferences

- **Status:** Accepted — implemented 2026-07-06.
- **Date:** 2026-07-06
- **Deciders:** Project Horizon team
- **Extends:** ADR-0019 (Telegram bot adapter), ADR-0015 (config-driven preferences),
  ADR-0026/0028 (per-chat preferences & memory), ADR-0011/0023 (read-only web surface).

## Context

The web viewer was read-only and stateless: preferences (topics, brief length)
existed only in the Telegram bot, keyed by `chat_preferences.chatId`. We want a
person to have **one** set of preferences across the web app and the bot, and we
want the web to remember them across visits.

A first pass stored a name + prefs in the browser's `localStorage` — but that is
per-browser, unverified, and does not link the two surfaces. The obvious "real
account" route is phone-number + SMS OTP, which we explicitly rejected: it costs
money per message forever (a paid provider like Twilio) and adds PII we don't want
to hold.

The key realisation: **Telegram is already our identity provider.** For a private
chat, the Telegram `chatId` uniquely identifies the user, and it is the exact key
`chat_preferences` already uses. So the web doesn't need its own accounts — it just
needs to prove, for a given browser session, *which Telegram chat it is*.

## Decision

Add a free, SMS-less **pairing** flow ("Log in with Telegram"):

1. **Pending session + code (web).** `POST /api/auth/start` mints an opaque session
   token (httpOnly, SameSite=Lax cookie) and a short-lived, single-use pairing code
   (`web_sessions` + `link_codes` tables, ADR-0002 libsql — the data layer is
   unchanged, we only moved hosting to an Oracle Cloud VM). It returns the code plus a
   `t.me/<bot>?start=link_<code>` deep link when `TELEGRAM_BOT_USERNAME` is set.
2. **Claim (Telegram).** The user opens the deep link (or sends `/link <code>`). The
   bot's `handleLink` claims the code for its `chatId` — which *proves* the visitor
   controls that account, since the message provably came from it. The Telegram first
   name is captured only for a greeting.
3. **Promote (web).** The web polls `GET /api/auth/status`; on the first poll after a
   claim, the session is promoted to carry that `chatId` and the code is consumed.
4. **Shared preferences.** `GET`/`PUT /api/preferences` read and write the **same**
   `chat_preferences` row (via the same `ChatPreferencesRepo` the bot uses), so a
   change on either surface is immediately visible on the other.

Guests (no Telegram link) keep working: topics/minutes/format/theme persist in
`localStorage`; connecting Telegram upgrades them to synced, cross-device prefs.

## Consequences

- One identity, one preference set, across web and bot — no passwords, no phone
  numbers, no SMS provider, no recurring cost. Telegram does the authentication.
- The web session is a low-sensitivity cookie (news prefs only). It is httpOnly +
  SameSite=Lax; `secure` is intentionally not required because the current Oracle VM
  deployment serves over `http://<ip>:3000` (no domain/TLS yet). If a domain + HTTPS
  is added later, the official Telegram Login Widget becomes an optional one-click
  upgrade over this pairing flow.
- Codes are single-use and short-lived (10 min default); sessions default to 30 days.
- Linking requires the bot to be running and the chat to be permitted by the
  existing access model (`openAccess`/`allowedChatIds`, ADR-0022). When auth isn't
  wired, the viewer degrades to the guest-only, localStorage experience.
- Rejected: phone + SMS OTP (cost + PII), self-asserted "type the same id in both"
  (unverified — anyone could claim another's id), and web-native password accounts
  (maintenance burden, and doesn't unify with Telegram).
