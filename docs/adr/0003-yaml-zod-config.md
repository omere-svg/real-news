# ADR-0003: YAML configuration validated by Zod

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The tick interval (`X` minutes), enabled Sources, Topic preferences, score thresholds, and
model-tier settings are all operator-tunable and structured. The spec stresses the
interval is "defined dynamically in a configuration file." Humans edit this file often.

## Decision

Configuration lives in a **YAML** file, parsed and validated at startup against a **Zod**
schema, producing a **frozen, typed `Config`** object injected everywhere it is needed.
Secrets (API keys) stay in `.env`, never in the YAML.

## Consequences

- Human-friendly: comments and easy editing of the interval and Source list.
- Fails fast at boot on invalid config; the Zod schema is the single source of truth and
  doubles as documentation.
- `Config` is immutable and explicitly passed (no global singleton), so tests construct
  their own config without touching disk.

## Alternatives considered

- **JSON + Zod** — no comments, noisier to hand-edit.
- **.env only** — poor fit for structured data like a per-Source settings list.
