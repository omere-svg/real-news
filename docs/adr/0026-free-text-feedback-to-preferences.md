# ADR-0026: Free-text feedback → soft preference weights

- **Status:** Accepted — implemented 2026-06-18.
- **Date:** 2026-06-18
- **Deciders:** Project Horizon team

## Context

Per-chat preferences exist (ADR-0015/0019/0022) but are **structured and explicit**: a user must
type `/prefs topics AI,Geopolitics` choosing from a controlled vocabulary, and those topics/regions
act as **hard include-filters** in `HorizonQuery.select` (`horizon-query.ts:83`) — the brief shows
*only* the chosen partitions, ranked by Significance. There is no way to say "a bit less sports,"
"more AI but keep the rest," or to have the bot **learn** from a reaction over time.

We want the user to say, in plain language, *what was good or bad* — "loved the AI, too much
sports, keep it shorter" — and have the brief adapt next time, persistently. Two facts shape the
design:

1. **Hard include-lists can't express "less."** "Less sports" under include-list semantics means
   "list every topic except Sports" — clumsy, and it can't represent *degree* or accumulate.
2. **Free text is a model task, but the adjustment must stay deterministic.** We must not let an
   LLM write arbitrary state; it should only *interpret intent*, with the math applied by tested
   pure code.

## Decision

### 1. A `/feedback <free text>` command (Telegram only)

A new command on the bot: `/feedback briefs too long, more AI, less sports`. Explicit and
discoverable (in `/help`), so it can't accidentally consume normal messages. `/feedback undo`
reverts the last adjustment. Feedback is a per-chat concern, so — like all per-chat prefs — it
lives on the Telegram surface only; the keyless web viewer keeps using config defaults (ADR-0015).

### 2. Soft preference **weights**, not include-lists

Introduce a per-chat **preference weight** per Topic and per Region: neutral = `1.0`, `>1`
emphasizes, `<1` de-emphasizes, `0` mutes. They are stored on `chat_preferences`
(`topicWeights`, `regionWeights` JSON columns; plus a `prev` snapshot for one-level undo) and
applied as a **soft re-rank** in the Presentation layer: `select()` orders the Significance pool
by `significance × topicWeight × regionWeight` and drops muted partitions, then budgets as before.

This keeps the split clean: **Significance stays global and objective** (the tick pipeline is
untouched — ADR-0008); **preference weighting is per-user and lives in Presentation** (ADR-0015),
exactly where personalization belongs. Explicit `/prefs topics` include-filters still apply first
as a hard scope; weights bias within it. The two mechanisms coexist.

### 3. LLM interprets *intent*; pure code applies the *math*

A new method on the model seam (`LLMClient.interpretFeedback`, cheap tier — sibling to
`classify`) maps free text → a validated `FeedbackIntent`: per mentioned Topic/Region a
**direction** (`more | less | mute | reset`), an optional length nudge (`shorter | longer |
reset`), and a human `summary` for the confirmation reply. Invalid vocabulary is dropped at the
Zod boundary.

The bot depends on a **narrow `FeedbackInterpreter` seam** (`Pick<LLMClient,
'interpretFeedback'>`), not the whole client — it has no business calling `classify`/`narrate`.

A **pure `applyFeedback(profile, intent, opts)`** (`src/preferences/feedback.ts`) turns the intent
into a new profile deterministically: each direction is a clamped step (`more`/`less` = ±0.5 in
`[0.25, 3]`, `mute` = 0, `reset` = back to neutral); length nudges the default minutes
multiplicatively, clamped to `[1, maxMinutes]`. This is the whole testable core — the LLM never
touches numbers or storage.

Flow: `interpretFeedback` (model) → `applyFeedback` (pure) → snapshot current into `prev` →
persist → reply with `intent.summary` and `(/prefs to view, /feedback undo)`.

## Consequences

- **Easier:** the user personalizes in one natural sentence; adjustments accumulate and persist;
  "less/mute/more" all work; `/feedback undo` and `/prefs` give transparency and reversibility.
  The objective Significance pipeline is untouched.
- **Bounded blast radius:** one command (pure), one narrow LLM seam method, one pure weighting
  module, three nullable `chat_preferences` columns (one migration), and a re-rank inside
  `select()`. Existing bot/query tests stand because weights default to neutral.
- **Accepted trade-offs:**
  - **Telegram-only.** The web viewer has no per-user identity, so feedback doesn't apply there
    (consistent with all per-chat prefs).
  - **One-level undo.** A single `prev` snapshot, not full history — enough for "oops, revert
    that," far simpler than an event log.
  - **Costs a cheap-tier call** per feedback; covered by the existing per-chat daily command
    quota (ADR-0022). It is not the podcast path.
  - **Re-rank within the candidate pool**, not the whole corpus — a strongly down-weighted topic
    can still appear if little else qualifies; acceptable for a bias (not a filter).

## Alternatives considered

- **Edit the existing include-lists from feedback** (no weights). Rejected: can't express degree
  or "less," and each feedback would *replace* rather than *nudge* — no learning.
- **Plain (non-command) messages as feedback.** Rejected for now: would send every stray message
  to the model (cost + misread) and override the `unknown → help` affordance. `/feedback` is
  explicit; can revisit.
- **Let the LLM emit the new weights directly.** Rejected: hands arbitrary state to the model.
  Interpreting *intent* and applying clamped math in tested pure code keeps it safe and inspectable.
- **A weighting term in the tick scorer (ADR-0008).** Rejected: Significance is global and
  per-user weighting is presentation; mixing them would pollute the objective score and the shared
  cache.
- **Full undo history / preference event log.** Rejected as over-engineering for the MVP; one
  `prev` snapshot covers the real need.
