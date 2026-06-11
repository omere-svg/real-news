# ADR-0004: Pluggable SourceAdapter seam, zero scraping

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

Phase 1 must extract from multiple heterogeneous public APIs and add more later without
churning the pipeline. Principle 2 mandates *strictly zero scraping* — official, public,
stable developer APIs only.

## Decision

Define a **`SourceAdapter`** interface — the Source seam — with a uniform extraction
contract and a non-blocking **`healthCheck()`**. Phase 1 ships four adapters: **Hacker
News** (Firebase API), **GDELT 2.1** (Doc API), **data.gov.il/Knesset** (CKAN), and
**arXiv** (Atom API). A `FakeSource` adapter backs tests. Each adapter declares how its
native metadata maps to Region/Topic (see ADR-0009).

## Consequences

- Adding a Source is implementing one interface; the pipeline is unchanged.
- Four real adapters + a fake make this a real seam, not a hypothetical one.
- Region coverage: data.gov.il → Israel; the rest → World-leaning. Topic coverage: arXiv/HN
  → AI, GDELT → Geopolitics.
- No HTML/UI dependence, so adapters are stable and don't break on site redesigns.
- HN is built end-to-end first under TDD; the others follow the same contract.

## Alternatives considered

- Hard-coding fetch logic per Source inline in the pipeline — no seam, untestable, brittle.
