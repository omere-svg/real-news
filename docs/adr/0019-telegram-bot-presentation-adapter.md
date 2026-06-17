# ADR-0019: Telegram bot as a second Presentation adapter

- **Status:** Accepted
- **Date:** 2026-06-17
- **Extends:** ADR-0011 (Presentation seam), ADR-0015 (preferences — reopened below).

## Context

The web viewer is one read-only Presentation surface over the cache. We want a Telegram bot
that delivers time-budgeted briefs, outlines, and podcast audio to chat, and lets each user
keep their own preferences. Telegram is inherently multi-user (one bot, many chats), unlike
the single-user local web viewer.

## Decision

Build the bot as a **second Presentation adapter** over the existing seams — it consumes the
same `QueryEngine` and `StoryRepo` and never touches the pipeline (Principle 4: read-only
over the pre-compiled cache).

- **Thin transport seam.** `TelegramTransport` (`sendMessage` / `sendAudio` / `getUpdates`)
  over the HTTP Bot API via `fetch` — zero new dependencies, mirroring `ChatTransport`
  (ADR-0016). Token from `TELEGRAM_BOT_TOKEN` (env, never config). Updates by **long-poll**
  (no public URL / webhook needed for an in-process daemon).
- **Pure command kernel.** `parseCommand(text) → Command` — a side-effect-free parser
  (`/brief`, `/outline`, `/podcast`, `/prefs …`, `/start`), exhaustively unit-testable like
  `budgetStories`.
- **Deep dispatcher.** `HorizonBot` maps `update + per-chat prefs → BriefRequest →
  QueryEngine → transport actions`. Tested against fakes; no network in tests.
- **Per-chat persisted preferences** (reopens ADR-0015). A `ChatPreferencesRepo` + table
  keyed by `chatId` holds `{topics, regions, defaultMinutes}`, edited via `/prefs`. Config
  defaults (ADR-0015) remain the fallback when a chat has set nothing. The single-user web
  viewer keeps config-only prefs; persistence is added only because the bot is multi-user.
- **Safety.** An optional `telegram.allowedChatIds` allowlist gates who the bot answers
  (empty = open). Bot runs in the same process as the tick loop and Hono server, started at
  the composition root and disabled by default (`telegram.enabled`).

## Consequences

- The bot reuses every reasoning artifact already in the cache — no new query logic.
- Two Presentation adapters now justify the `QueryEngine` seam (web + Telegram).
- New persistence (one table, one repo, one migration) and a long-poll loop; everything else
  is composition.
- Per-chat prefs live behind a repo seam, so a future web login could share it.

## Alternatives considered

- **grammy / telegraf framework** — richer middleware, but a dependency and a less-isolated
  test surface; our command set is small enough for a thin transport.
- **Webhook delivery** — lower latency at scale, but needs a public HTTPS endpoint; long-poll
  fits a self-hosted daemon and is trivially testable.
- **Config-only preferences for the bot** — simplest, but every chat would share one set of
  prefs, which defeats a multi-user bot.
