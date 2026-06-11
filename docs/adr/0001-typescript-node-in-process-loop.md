# ADR-0001: TypeScript/Node runtime with an in-process async tick loop

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

Project Horizon is a long-lived background daemon that extracts from public APIs, runs an
LLM reasoning pipeline, and writes a local DB. We need a runtime that handles async I/O
well, has a first-class Anthropic SDK, and keeps Phase 1 infra to zero.

## Decision

Build in **TypeScript on Node**. The Extraction Worker is a **single long-lived process**
running an **in-process async scheduler**: a tick fires every `X` minutes (from config)
and runs the pipeline once. No external job queue or scheduler process.

## Consequences

- Zero infra to run a tick; trivial to start, test, and reason about.
- Each Source's extraction is wrapped in its own try/catch so one dead endpoint is skipped
  and logged, never crashing the loop (satisfies the "non-blocking health check" mandate).
- Single-node only; no durability across crashes mid-tick. Accepted for Phase 1.
- Data/NLP work (embeddings) leans on a local model rather than a rich Python ecosystem
  (see ADR-0007).

## Alternatives considered

- **Python/asyncio** — stronger data/NLP ecosystem, but the team chose a single TS stack.
- **Go** — best for a crash-resistant daemon, but thin LLM/embedding ecosystem.
- **External queue (BullMQ + Redis)** — durable/retryable, but requires Redis. Phase 2.
