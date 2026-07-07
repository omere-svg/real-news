# ADR-0058: Web podcast plays real audio; explicit Generate gate; restart-safe callbacks

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

Three rough edges surfaced from live use of the deployed viewer + bot:

1. **The web podcast returned a script, not audio.** `/api/podcast` produced the
   narrated *script* text only; the config even documented it as "script-only (no
   web TTS)". The Telegram bot, by contrast, synthesized real mp3 (ADR-0020). The
   web should play a real episode, not a wall of text.
2. **Choosing a format/topic auto-generated.** Selecting Brief / Topic outline /
   Podcast — or toggling a topic chip while on one of those tabs — immediately
   fired the underlying model call. Each of those is a paid path (podcast also
   TTS), so idle browsing silently burned tokens the reader never asked for.
3. **The Connected popup had no explicit close.** It could be dismissed by the
   scrim or Escape, but there was no visible ✕ affordance.

Separately, the server logs showed repeated `telegram.handler_failed
{"err":"Error: telegram answerCallbackQuery 400"}`. On each deploy the bot's
long-poll offset resets to 0 and Telegram re-delivers recent button taps whose
callback-query ids have since expired; answering them 400s, and that error was
propagating out of the update handler and spamming the log on every restart.

## Decision

- **Share one TTS synthesizer between the bot and the web** (built once in the
  composition root, ADR-0020). `/api/podcast` now returns `{ script, audio }`:
  when a synthesizer is wired it narrates the script to mp3 and ships the bytes
  as base64 `audio`; a TTS failure degrades to `audio: null` + `script` (never a
  failed response). The script is always returned too, so the viewer shows it as
  a collapsible transcript under the player.
- **Web audio reuses the existing cost ceilings, adding no new uncapped vector:**
  the tighter `maxPodcastMinutes` clamp, the per-IP limiter, and the shared
  `global:podcast` daily budget (ADR-0052) all still gate the endpoint. The
  budget is charged once, on successful script generation, before synthesis.
- **An explicit ✨ Generate button gates the paid formats.** Stories stays live
  (a free, deterministic cache read), but Brief / Topic outline / Podcast never
  run on a tab, topic, or time change — they show a "press Generate" placeholder
  and only produce on the button press. This makes every model/TTS spend a
  deliberate, reader-initiated action.
- **A ✕ close button on the login/Connected sheet**, alongside the existing
  scrim-click and Escape.
- **Answering a callback query is now best-effort:** a stale/expired
  `answerCallbackQuery` after a restart is caught and logged at `warn`
  (`telegram.answer_callback_skipped`) instead of failing the whole update. The
  tap's action had already run; acknowledging it is pure UI.

## Consequences

- The web is now at parity with the bot for podcasts: a real, playable episode
  with the transcript one tap away.
- Token/TTS spend on the web is reader-initiated only; passively opening the
  viewer or flipping tabs costs nothing until Generate is pressed.
- Deploys no longer spam `handler_failed`; a re-delivered stale tap is a quiet
  `warn`, and one bad tap can't mark its update as failed.

## Alternatives considered

- **A separate `/api/podcast.mp3` audio route.** Rejected: it would generate the
  script twice (double LLM + double budget charge) or require caching the script
  between two requests. One endpoint returning both keeps a single charge.
- **Keep auto-generate but add a "confirm before spend" dialog.** More clicks for
  the same outcome; a single Generate button is the plainer model.
- **Persist the poll offset across restarts** (so Telegram never re-delivers old
  taps). A larger change with a per-poll write; the best-effort catch fixes the
  observed symptom without it, and Telegram still re-delivers *messages* so no
  real command is lost on restart.
