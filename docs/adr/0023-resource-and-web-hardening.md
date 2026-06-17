# ADR-0023: Resource & web-surface hardening

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

Beyond the Telegram quotas (ADR-0022), the review found cost/DoS exposure on other surfaces:
the web `/api/podcast` endpoint is unauthenticated and calls the LLM; `minutes` is unbounded
and parsed from raw `Number()` (so `NaN`/huge values select the entire candidate pool at full
depth — the worst-case cost per call); the Source fetcher has no timeout or size cap; and the
local DB file is created world-readable.

## Decision

- **Bound `minutes`.** A pure `normalizeMinutes(value, max)` rejects `NaN`/≤0 and clamps to
  `presentation.maxMinutes` (default 60). Applied on both surfaces (web query param and the
  Telegram request builder), so no single call can be amplified.
- **Disable the web LLM endpoint by default.** `/api/podcast` is gated behind
  `presentation.webPodcastEnabled` (default `false`) → returns 404 when off. The web UI keeps
  the list, brief, and outline (all $0). Telegram is the audited podcast surface.
- **Bind to localhost by default.** The server binds `HOST` (default `127.0.0.1`); remote
  exposure is an explicit opt-in (`HOST=0.0.0.0` behind a real proxy).
- **Harden `fetchJson`.** Add `AbortSignal.timeout(sources.fetchTimeoutMs)` and a max
  response-size guard (`sources.maxResponseBytes`); a slow or oversized upstream fails the one
  Source, not the tick.
- **Protect data at rest.** Create the SQLite file with `0600` permissions; never log pref
  contents. Per-chat preference isolation (already enforced by `chatId`-scoped queries) is
  pinned with a test. Stored prefs are already restricted to the controlled vocabulary.
- **Pin XML safety (documented).** `fast-xml-parser` does not expand DTD/external entities by
  default, so XXE/billion-laughs is not exploitable; recorded here so future parser changes
  preserve it. Telegram replies stay plain-text (no `parse_mode`); any future formatting must
  escape source-derived text.

## Consequences

- The open, unbounded LLM cost vector on the web is closed by default; opt-in for deploys.
- The tick can't be hung or OOM'd by a hostile/broken upstream.
- Bot/cache data isn't readable by other local users by default.

## Alternatives considered

- **IP rate-limit the web `/api/podcast`** instead of disabling it — keeps it reachable but
  adds a middleware + IP-keyed limiter; rejected for v1 in favour of off-by-default (simpler,
  safer). Can be revisited for a deployed multi-client web UI.
- **Shared-secret header for `/api/podcast`** — viable for remote deploys; deferred until a
  real remote web use-case exists.
