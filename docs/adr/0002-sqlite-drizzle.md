# ADR-0002: SQLite + Drizzle ORM for the intelligence cache

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

The spec calls for a *localized server database* optimized for high-speed reads, with
strict relational structure (Region/Topic/Significance). We want fast tests and minimal
infra.

## Decision

Use **SQLite** as the store, accessed through **Drizzle ORM** for a typed schema and
migrations in TypeScript. Tests run against an **in-memory SQLite** database for full
isolation per test.

**Driver:** `@libsql/client` (via `drizzle-orm/libsql`), not `better-sqlite3`. libsql is
SQLite-compatible and ships prebuilt binaries, so it builds cleanly on bleeding-edge Node
(26) where `better-sqlite3`'s `node-gyp` native compile fails. In-memory is `:memory:`.

## Consequences

- "Local server database" literally — embedded, no running service, extremely fast reads.
- Typed schema doubles as documentation; migrations are versioned in-repo.
- In-memory DB makes the Store seam fast and deterministic to test without a fake.
- Concurrent multi-writer scenarios are limited; fine for a single-node daemon.
- Vector search for dedup is *not* done in SQLite for Phase 1 (see ADR-0007); `sqlite-vec`
  is a clean future upgrade path.

## Alternatives considered

- **PostgreSQL + pgvector** — server-grade, built-in vectors, but adds infra and
  contradicts the local/embedded framing for an MVP.
- **Prisma** — popular DX, but heavier runtime and more awkward in-memory test isolation.
