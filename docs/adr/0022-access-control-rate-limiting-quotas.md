# ADR-0022: Access control, rate limiting, and per-chat cost quotas

- **Status:** Accepted
- **Date:** 2026-06-17
- **Extends:** ADR-0019 (Telegram bot), ADR-0020 (TTS).

## Context

The only user-driven OpenAI cost is the **podcast** path (`narrate` + TTS); text brief and
outline are deterministic ($0). Today nothing bounds podcast usage: a chat can spam
`/podcast` and drain the OpenAI balance, the Telegram allowlist defaults to *open*, and a
burst of expensive commands serially blocks the single poll loop. We need access control,
rate limiting, and durable cost quotas — without breaking the seam-driven, testable design.

## Decision

Three layers, enforced in `HorizonBot` **before** any expensive work:

1. **Default-deny access.** `telegram.openAccess` (default `false`). When the bot is enabled
   and `allowedChatIds` is empty and `openAccess` is false, it answers **no one** and logs a
   loud boot warning. `allowed(chatId)` stays the single chokepoint; non-allowed chats are
   ignored silently (no reply ⇒ no amplification).

2. **Burst rate limit (in-memory).** A `RateLimiter` seam with a `FixedWindowLimiter`
   (capacity per window, injected clock → pure & testable). `telegram.limits.perMinute`
   caps *all* commands per chat, protecting the poll loop and the DB from hammering.

3. **Durable cost quotas (persisted).** A `UsageRepo` over a `usage` table keyed by
   `(key, day)` counts per-chat and global usage. `incrementAndGet` returns the new count;
   the command is allowed iff it is `<= limit` (blocked attempts still count, so spam stays
   blocked). Persisted so a process restart cannot reset the budget. Limits:
   `podcastPerDay` (per chat), `commandsPerDay` (per chat), and `globalPodcastPerDay` (a
   process-wide hard ceiling on the OpenAI bill regardless of per-chat limits).

Over-limit replies are themselves rate-limited (one notice per window) so spamming a blocked
command does not earn a reply each time. `minutes` is clamped (ADR-0023) so a single allowed
call cannot be amplified.

## Consequences

- A chat's worst case is `podcastPerDay` narrate+TTS calls/day; the whole bot's worst case is
  `globalPodcastPerDay`. The bill is bounded by config, not by attacker behaviour.
- Quotas survive restarts; burst limiting stays cheap and in-memory.
- New seams (`RateLimiter`, `UsageRepo`) keep enforcement unit-testable with fakes/clocks.
- In-memory limiter state grows with distinct chats (bounded by real users); pruning is a
  later optimisation, noted not implemented.

## Alternatives considered

- **In-memory quotas** — simpler, but a restart (or a crash-loop) resets the cost budget;
  rejected for the durable table.
- **Token-bucket vs fixed-window** — fixed-window maps directly to "N/minute" and is trivially
  testable; token-bucket's smoothing isn't needed here.
- **No global ceiling** — per-chat limits alone can still sum to a large bill across many
  chats or a misconfigured allowlist; the global cap is the backstop.
