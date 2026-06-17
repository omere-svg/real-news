# ADR-0015: User preferences are config-driven, not a persisted per-user store

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

Principle 5 wants the query layer to honour "user preferences (e.g. AI, geo-politics
etc.)" alongside the time budget. Phase 1 left a static `presentation.preferredTopics` in
config, unused. We need to decide where preferences live and how they reach the
`QueryEngine` and the viewer.

Project Horizon is a single-user, locally-run background agent (ADR-0001). There is no
auth, no accounts, and no multi-tenant requirement.

## Decision

Preferences are **config-driven** (ADR-0003), not a persisted/editable store. The
`presentation` config block is extended with:

- `preferredTopics` / `preferredRegions` — controlled-vocabulary defaults (validated
  against the `Topic`/`Region` enums).
- `defaultMinutes` — the default attention budget.
- the budget tunables the query layer needs: `textWordsPerMinute`, `audioWordsPerMinute`,
  `candidatePool`, and per-depth `wordCost` (the ADR-0013 cost model).

`load.ts` maps the validated config into the two presentation contracts —
`toQueryParams(config)` → `QueryParams` and `toPresentationDefaults(config)` →
`PresentationDefaults` — in the same single, tested place `toTickConfig` already lives. The
composition root wires them; the HTTP layer applies the defaults whenever a request omits
`minutes`/`region`/`topic`, and the viewer seeds its time slider from `defaultMinutes`.

## Consequences

- One source of truth for preferences and budget tunables; no new schema, table, or repo.
- The whole budget cost model is now tunable without code changes.
- Requests still override preferences per call (pick a topic / drag the slider), so the
  defaults are a starting point, not a cage.
- If multi-user or in-app editing is ever needed, a persisted store can replace the config
  source behind the same two mapping functions — the seams don't change.

## Alternatives considered

- **Persisted preferences table + repo, editable from the UI** — necessary for multi-user
  or cross-device sync, but unjustified scope for a single-user local tool; adds a table,
  migration, repo, and write endpoints for no current benefit.
