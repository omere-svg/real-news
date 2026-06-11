# ADR-0009: Classification metadata-first, LLM fallback

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

Every Story needs a Region (Israel/World) and Topic. Some Sources hand us reliable metadata
(GDELT geo/themes, arXiv categories, data.gov.il ⇒ Israel by definition); others (HN)
give us only a free-form title.

## Decision

Classify **metadata-first**: each `SourceAdapter` declares how its native metadata maps to
Region/Topic, and that deterministic path is used whenever the metadata is present and
reliable. Only when metadata is missing or ambiguous do we **fall back to a Haiku
classification call**.

## Consequences

- Cheapest and most accurate: we don't pay tokens to re-derive what GDELT/arXiv already
  state, and the metadata path is deterministic and unit-testable.
- The LLM fallback is isolated and mockable; HN-style free-form titles still get classified.
- Region/Topic remain controlled vocabularies, not free text (see CONTEXT.md).

## Alternatives considered

- **Always LLM classify** — uniform but wasteful and less deterministic.
- **Pure rules/keyword** — cheapest, but brittle on free-form titles.
