# ADR-0008: Hybrid significance — deterministic signals + bounded LLM adjustment

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The spec demands Significance be driven by *verifiable signals* (0.0–10.0) yet still
reflect editorial judgment. Pure-LLM scoring is non-deterministic and ignores the signals
mandate; pure-formula scoring can't see intrinsic importance the signals undervalue.

## Decision

Significance is **hybrid**. A pure function **`computeBaseScore(signals)`** turns verifiable
Signals — source points/velocity, GDELT mention count/tone, source weight, recency decay,
and corroboration (Cluster size) — into a base score. The Reasoner then applies a **bounded
editorial adjustment** (clamped to a small range) on top. The final score is clamped to
`0.0–10.0`.

## Consequences

- The core scoring math is a pure, trivially unit-testable function — the highest-value TDD
  target in the project.
- "Verifiable signals" is honored: the base is fully inspectable and reproducible.
- The LLM can nudge but never dominate (bounded), so scores stay stable and explainable.

## Alternatives considered

- **Pure signal formula** — maximally testable, but blind to editorial importance.
- **Pure LLM judgment** — captures nuance, but non-deterministic and ignores the mandate.
