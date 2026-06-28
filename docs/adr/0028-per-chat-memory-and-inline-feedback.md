# ADR-0028: Per-chat memory + per-answer inline feedback

- **Status:** Accepted — implemented 2026-06-25.
- **Date:** 2026-06-25
- **Deciders:** Project Horizon team
- **Extends:** ADR-0019 (Telegram adapter), ADR-0026 (free-text feedback), ADR-0020 (TTS).

## Context

Two gaps in personalization remained after ADR-0026:

1. **No persistent personal context fed to the model.** Preferences were only
   deterministic weights/filters; nothing the user *says about themselves* ("I run
   a port in Haifa", "I trade commodities") ever reached an LLM prompt, so generated
   content (podcast narration, and now chat — ADR-0029) couldn't be tailored.
2. **Feedback was a command the user had to remember.** `/feedback …` works, but
   there was no affordance to react *right after* receiving an answer.

## Decision

### 1. A per-chat free-text **memory**

Add one nullable `memory` column to `chat_preferences` (one migration). Set via
`/remember <text>` (appends, newline-joined, capped at 2000 chars), cleared via
`/forget`, shown in `/prefs`. It is injected as a **`READER CONTEXT` preamble** into
the LLM content paths — `narrate` (ADR-0020) and `discuss` (ADR-0029) — via an
optional `memory` field threaded through `BriefRequest` → `NarrateInput` /
`DiscussInput`. The model is told to *tailor to* it, not quote it.

Memory is **per-chat**, like all bot prefs (ADR-0019), so it stays on the Telegram
surface; the keyless web viewer is unaffected. It never touches the objective tick
pipeline (Significance stays global — ADR-0008): personalization lives in
Presentation, exactly as ADR-0015/0026 established.

### 2. A per-answer **inline feedback button**

Extend the thin `TelegramTransport` seam to carry inline keyboards and callback
queries: `sendMessage(…, { buttons })`, an `answerCallback`, and a `TelegramUpdate`
that may carry `callbackData`/`callbackQueryId` (mapped in the pure `toUpdates`).
Every generated answer (brief/outline/podcast/chat) gets a single **"✍️ Give
feedback"** button. Tapping it parks the chat in a `feedback` state for exactly one
message; that next plain-text message is routed into the existing ADR-0026 feedback
path, then the chat returns to conversation mode.

A small in-memory `ChatSession` per chat (`mode` + conversation `history`) drives
this routing; it is transient by design (no persistence needed for a button state).

## Consequences

- **Easier:** users state durable context once and every reply respects it; they
  can tune from a one-tap button instead of recalling a command.
- **Bounded:** one DB column + migration; an additive, backward-compatible transport
  contract (existing callers pass no buttons); the model still only *interprets*
  feedback while pure `applyFeedback` does the math (ADR-0026).
- **Accepted trade-offs:**
  - **Telegram-only**, in-memory session state — consistent with per-chat prefs;
    a process restart forgets the transient `mode`/`history`, not the saved memory.
  - **Memory is unstructured free text** the model reads; it is length-capped to
    bound prompt cost, not parsed into fields.
  - **Audio can't carry buttons**, so the podcast follows its audio with a short
    affordance message bearing the button.

## Alternatives considered

- **Auto-derive memory from `/feedback` history.** Rejected: feedback expresses
  *ranking* intent, not durable personal facts; an explicit `/remember` is clearer.
- **A text hint instead of a button** ("reply /feedback …"). Rejected: the user
  asked for a real one-tap option after every answer.
- **Persist session/conversation state in the DB.** Rejected as over-engineering;
  the conversation is naturally ephemeral and cheap to rebuild from the cache.
- **Feed memory into the tick scorer.** Rejected for the same reason as ADR-0026:
  Significance is global; per-user context belongs in Presentation.
