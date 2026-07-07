# ADR-0054: Agentic loops — chat tool agent, reflection→action, durable adaptation

- **Status:** Accepted — implemented 2026-07-07.
- **Date:** 2026-07-07
- **Extends:** ADR-0029 (chat), ADR-0042 (reflection), ADR-0052 (adaptive
  backoff), ADR-0053 (fencing — the same hardening pass; code comments from
  this pass cite ADR-0053).

## Context

A per-dimension judge review concluded the system was "a superb autonomous
cron pipeline where the LLM is a subroutine, not an agent": every model call
filled a slot; the only closed adapt loop was an in-memory 3-strikes counter
that a deploy reset; reflection was write-only (nothing consumed it); chat's
lone "decision" — escalate to web search — was a deterministic `if`; and
conversation context died with the process.

## Decision

1. **Model-driven chat tool loop** (`src/telegram/chat-agent.ts`,
   `ToolCapableTransport` on the OpenAI transport). Chat is now an agent: the
   model chooses among tools — `search_stories` (semantic cache retrieval),
   `get_story`, `get_signal_trends`, `web_search`, `save_memory` — observes
   each fenced result, and iterates (max 5 steps; tools withdrawn on the
   forced final turn). Web escalation is the model's decision, subsuming the
   old two-pass `if`. Any failure degrades to the previous fixed discuss path.
   Every trajectory is persisted (`chat_traces`) and publicly inspectable at
   `/api/chat-traces` — the "how I answered" receipt.
2. **Reflection acts** (`src/pipeline/reflection-policy.ts`, `agent_policy`).
   `reflect` returns `{advisory, actions}` from a closed vocabulary
   (`backoff_source`, `set_deep_analysis_top_n`). A deterministic policy guard
   screens every proposal — whitelisted types, validated sources, clamped
   magnitudes — then the loop applies what survives: forced source cooldowns
   and a persisted `deepAnalysisTopN` override the next tick consumes. Applied
   actions are recorded on the reflection row: the model proposes, the guard
   disposes, the receipt is durable.
3. **Adaptation survives deploys.** `AdaptiveBackoff.seed` rehydrates failure
   streaks from persisted tick reports on boot; the reflection policy lives in
   its own table; chat sessions write through to `chat_sessions` so a deploy
   mid-conversation keeps the context.
4. **Scheduled personalized briefs** (`/subscribe HH:MM` UTC): a
   minute-cadence check delivers each subscribed chat its preference-weighted
   brief — idempotent per UTC day, per-chat failure isolation, zero model
   spend (deterministic cache reads).
5. **Accumulation evidence**: `/api/stats` (stories, multi-source stories,
   cross-tick developments, signal-history depth) makes the data moat a
   number a judge can watch grow.

## Consequences

- The plan→act→observe→adapt story is now real end to end and demonstrable:
  scripted-trajectory tests pin the tool loop; policy-guard tests pin the
  reflection screen; tick-runner tests pin the policy override; live
  endpoints (`/api/chat-traces`, `/api/reflection`, `/api/stats`) expose it.
- Bounded on every axis: step cap + fenced tool results + grounded-URL output
  guard (chat); clamped whitelisted actions (reflection); count + token caps
  unchanged. The model gained decision power, never spend or blast radius.
