# ADR-0030: Natural-language routing + tap-to-run buttons (intuitive Telegram UX)

- **Status:** Accepted — implemented 2026-06-25.
- **Date:** 2026-06-25
- **Deciders:** Project Horizon team
- **Extends:** ADR-0016 (chat transport), ADR-0019 (Telegram adapter),
  ADR-0026 (feedback tuning), ADR-0028 (sessions/inline buttons),
  ADR-0029 (chat about the news).

## Context

The bot's whole surface was slash commands (`/brief`, `/outline`, `/podcast`,
`/prefs`, `/feedback`, …). Slash commands are a discoverability and intuitiveness
barrier for casual users: you have to know they exist and remember their exact
syntax. We already had most of the machinery to do better — the Reasoner can turn
free text into structured intent (the ADR-0026 feedback interpreter and the
ADR-0029 `discuss` chat both do exactly this), and the inline-button plumbing
exists (ADR-0028). We wanted plain English and buttons to be the primary way to
drive the bot, **without** throwing away the slash commands power users like.

## Decision

A **hybrid**: a natural-language intent router in front of the existing
dispatcher, tap-to-run buttons for discovery and the common path, and slash
commands kept as (de-emphasized) aliases. No handler was rewritten — every input
funnels into the same `Command` dispatch.

### 1. A cheap-tier `routeIntent` seam on the Reasoner

Add `routeIntent(input) → { action, minutes, topic }` to `LLMClient` (cheap
tier). `action` is one of the user-facing intents (`brief`, `outline`, `podcast`,
`question`, `prefs`, `feedback`, `remember`, `forget`, `help`); the router also
pulls out an explicit time budget and topic. It is lenient by construction — an
unrecognised action degrades to `help`, and `topic` is a free string validated
downstream where the vocabulary lives. The bot depends only on a narrow
`IntentRouter = Pick<LLMClient,'routeIntent'>`, and `ResilientLLMClient` degrades
a routing failure to the menu (`action: help`).

### 2. The bot maps an intent onto an existing Command

`interpret` is now async: a slash command parses as before (and still wins);
plain text awaiting feedback is still captured as tuning (ADR-0028); otherwise,
when a router is wired, the message is routed and mapped onto the existing
`Command` (e.g. `question → chat` from ADR-0029, `feedback`/`remember` reuse the
raw message text). With no router wired the old session-mode behavior is kept
intact, so a slash-only deployment is unchanged.

### 2b. Plain-language preference edits (`interpretPrefs`)

Showing preferences (`/prefs`) wasn't enough: "reset my preferences" or "add
Politics and make it 5 minutes" must actually *change* them. So the router also
emits `setPrefs` / `clearPrefs`, and a second cheap-tier seam,
`interpretPrefs(input) → PrefsPatch`, names the edit: per-list `replace`/`add`/
`remove` for topics & regions, plus an optional default-budget. The bot validates
the values against the controlled vocabulary (dropping unknowns), merges them
onto the chat's hard filters, and echoes the resulting preferences back. This is
distinct from `interpretFeedback` (ADR-0026), which moves *soft* re-rank weights;
`interpretPrefs` edits the *hard* include-filters. `clearPrefs` reuses the
existing, tested `/prefs clear` path. The bot depends only on a narrow
`PreferencesInterpreter = Pick<LLMClient,'interpretPrefs'>`.

### 3. Tap-to-run buttons + menus

A main menu (`📰 Brief`, `🎧 Podcast`, `🔎 By topic`, `⚙️ Preferences`) rides on
`/start`, `/help`, and the catch-all. A `🔎 By topic` tap opens a one-tap topic
picker (`outline:<Topic>` per button). Navigation taps (menu, topic picker, the
ADR-0028 feedback button) are free state changes; **action** taps (brief,
podcast, prefs, a picked outline) map to a `Command` and go through the **same
quota + dispatch** path as a typed command, so a tapped podcast is metered like a
typed one. Generated replies now also carry a `☰ Menu` button. The transport
wraps a flat button list into rows (`toInlineKeyboard`) so menus stay readable.

These button affordances ride along only when natural-language routing is on
(`telegram.naturalLanguage`, default `true`); the feedback button (ADR-0028) is
unchanged and independent.

## Consequences

- **Easier:** users just say what they want or tap a button; nobody has to learn
  slash syntax. The change is contained — one new cheap seam plus a button layer
  in front of unchanged handlers.
- **Bounded:** routing is additive and gated. Off (`naturalLanguage: false`) the
  bot is exactly the pre-ADR slash bot; on, slash commands still take precedence.
- **Accepted trade-offs:**
  - **A cheap-tier model call per plain-text message** (bounded by the ADR-0022
    burst + daily command quotas). Slash commands and button taps skip the router.
  - **One action per message** (no compound "brief then podcast"). Simple and
    predictable for the MVP.
  - **`remember`/`feedback` reuse the raw message verbatim** rather than stripping
    a lead-in; the downstream interpreters already tolerate this.

## Alternatives considered

- **Pure natural-language (no buttons).** Rejected: same blank-page
  discoverability problem as slash commands, plus a model call on every message
  and more ambiguity ("shorter" = tune vs. this brief). Buttons fix intuitiveness
  most directly.
- **Drop slash commands entirely.** Rejected: zero-cost to keep as aliases, power
  users rely on them, and the dispatcher is indifferent to the input's origin.
- **A deterministic keyword router (no model).** Rejected: brittle against natural
  phrasing; the cheap tier already does robust intent classification elsewhere.
- **A persistent reply keyboard instead of inline buttons.** Deferred: inline
  keyboards reuse the existing callback plumbing (ADR-0028) and attach to replies.
