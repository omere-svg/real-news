# ADR-0029: Conversational chat about the news (cache-grounded, web fallback)

- **Status:** Accepted — implemented 2026-06-25.
- **Date:** 2026-06-25
- **Deciders:** Project Horizon team
- **Extends:** ADR-0011 (read-only Presentation), ADR-0016 (chat transport),
  ADR-0019 (Telegram adapter), ADR-0028 (sessions/memory).

## Context

Roadmap Phase 6, item 13 (revised). After receiving a brief, the user wants to
**discuss it** — ask follow-up questions and get answers. The answer should come
from the Story cache when possible, and only fall back to a **live web lookup**
when the cache can't answer. This is the first feature that may reach outside the
pre-compiled cache, so it must do so deliberately and stay off by default
(Principle 4: read-only over the cache; ADR-0023 hardening).

## Decision

### 1. A cache-first `discuss` seam on the Reasoner

Add `discuss(input) → { answer, answeredFromNews }` to `LLMClient` (deep tier).
The prompt grounds the answer in `StoryContext` drawn from the cache (plus the
reader's memory and recent turns — ADR-0028), and is told to say so plainly when
the material doesn't support an answer — reported back as `answeredFromNews:false`.
The bot depends only on a narrow `Discussant = Pick<LLMClient,'discuss'>`.

### 2. A pluggable, **off-by-default** `WebSearch` seam

`WebSearch.search(query) → WebResult[]`, wrapped in `ResilientWebSearch` (errors
degrade to `[]`). One real provider, `TavilyWebSearch` (key from `TAVILY_API_KEY`,
env-only; pure `toWebResults` mapping unit-tested, network not). Wired by the
composition root **only** when `telegram.chat.webSearch.provider = tavily` and a key
is present; otherwise chat stays strictly cache-grounded.

### 3. Bot flow: free-text chat after a brief

Reusing the ADR-0028 `ChatSession`: receiving a brief/outline/podcast arms `chat`
mode, after which a plain-text message is a question (`/chat <q>` and `/ask` work
explicitly too). The bot pulls the chat's preferred top Stories as context, calls
`discuss`; if `answeredFromNews` is false **and** web search is wired, it searches
and runs a **second** `discuss` pass with the web results, appending a
"(Sourced from a web search.)" provenance note. Conversation turns are kept (capped)
for multi-turn context. Chat draws the existing per-chat daily command quota
(ADR-0022); web search is the only egress and is rate-limited by that quota.

## Consequences

- **Easier:** the brief becomes a conversation; answers stay grounded and cite when
  they leave the cache. Web access is a single, isolated, resilient seam.
- **Bounded:** chat is additive — when `discussant`/`storyRepo` aren't wired, plain
  text keeps the old unknown→help behavior, so the default deployment is unchanged.
- **Accepted trade-offs:**
  - **Cache-first, single web escalation.** One extra `discuss` pass at most per
    question; no agentic multi-hop browsing.
  - **Coarse grounding (top-N preferred Stories), not semantic retrieval.** Simple
    and deterministic for the MVP; embedding-based retrieval over `story_vectors`
    (ADR-0017) is a clear future deepening.
  - **Deep-tier cost per question**, bounded by the per-chat daily command quota
    (ADR-0022); web search off unless explicitly configured and keyed.
  - **Telegram-only**, in-memory conversation state (ADR-0028).

## Alternatives considered

- **Always allow web search / answer from model knowledge.** Rejected: violates the
  cache-grounded promise; web is a deliberate, configurable fallback.
- **Voice mode (STT→reason→TTS).** Deferred: larger streaming/turn-taking surface;
  text reuses every existing seam. The TTS path (ADR-0020) remains available later.
- **Embedding retrieval for grounding now.** Deferred in favor of the simpler top-N
  pool; noted as the next deepening.
- **A new per-chat chat quota.** Rejected for the MVP: the existing daily command
  quota already bounds it.
