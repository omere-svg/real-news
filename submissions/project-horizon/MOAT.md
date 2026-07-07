# MOAT — Project Horizon

Every claim here is verifiable from the repo, the live deployment, or the running
DB. Nothing below is aspirational; where something is a *posture* rather than a
*guarantee*, it says so plainly. This document exists so a judge can check the
moat rather than take it on faith.

---

## 1. The compounding data asset: time-series that can't be backfilled

Horizon persists two kinds of history that accrue only by running, tick after
tick, and cannot be reconstructed after the fact:

- **Signal history** — per-tick readings of reader attention, news tone, market
  volatility, and citation impact from 6 independent signal sources, retained
  365 days. Live proof: the `oldestSignalAt` and signal-observation counters on
  `https://horizon-news.duckdns.org/api/stats`.
- **Corroboration *timing* per story** — the pipeline records *when* each
  additional source corroborated a developing event, across ticks. That "how
  fast did coverage converge" series is a byproduct of continuous operation.

**Why it's defensible (and 100% true):** a competitor can clone the code and the
story table today, but they cannot clone *yesterday*. Time-series data has no
backfill path — you either were running and recording on a given day or you
weren't. This is the single strongest, most literal moat claim, and it is
directly inspectable: `/api/stats` shows the counters climbing over the
deployment's lifetime.

**Honest boundary:** the depth of this moat today is measured in the days the
production instance has been running (since 2026-07-07), not years. The claim is
about the *mechanism* being real and already accumulating — not that the archive
is large yet.

---

## 2. A workflow no incumbent can copy without indicting themselves

- **What Horizon does:** shows the *arithmetic* behind every rank — an additive,
  named `ScoreBreakdown` rendered verbatim on both web and Telegram
  (`src/presentation/score-explanation.ts`), impact-scaled so prestige alone
  can't outrank a mass-casualty event.
- **What incumbents do:** engagement-ranked feeds (the ad-funded majority) and
  provenance/bias labelers (Ground News, Particle) — all still pull-and-read,
  none expose *why* a story ranks where it does as inspectable math.

**Why it's defensible (and 100% true as a structural argument):** an
engagement-ranked incumbent literally cannot publish "here is the arithmetic
behind this rank" without revealing that the arithmetic optimizes for time-on-page,
not consequence. The transparency is not a feature they're behind on — it's one
their business model structurally disallows. This is a positioning argument, not
a patent; it's stated as such.

---

## 3. Multi-tenancy is a config seam, not a rewrite

A tenant is a YAML config + a database. Both are env-driven in `src/main.ts`
(`HORIZON_CONFIG`, `DB_URL`), so a second, independent tenant boots today with
no code change:

```
HORIZON_CONFIG=config/alt.yaml DB_URL=file:./data/horizon-alt.db npm start
```

**Proof it actually boots:** `test/config/load.test.ts` loads and validates
`config/alt.yaml` against the same schema the primary instance uses. `alt.yaml`
enables two keyless sources against a separate SQLite file, so it needs no API
keys and starts fast. The tenant boundary is a real seam exercised by a test,
not a marketing bullet.

**Why it matters for the moat:** a vertical tenant (a legal-news config, a
biotech config, a policy config) inherits the whole scoring/merge/agent engine
and only supplies its own source list + weights. The cost to stand up a
defensible vertical is a config file, so the *data* moat in §1 can be multiplied
across verticals without re-engineering.

---

## 4. Compliance/procurement posture as a go-to-market wedge

Every enabled source is a documented public API or public RSS/XML feed; none
require scraping HTML or auth beyond an optional free demo key (full per-source
table in `EVIDENCE.md → Source terms`).

**Why it's a wedge (and stated honestly):** this is **not** a legal shield and
this document does not claim one. It is a *procurement* advantage — a B2B legal
review can clear an official-API-only ingestion path faster than a
scraper-based competitor's, which shortens enterprise sales cycles. That's a
real, checkable difference in posture, framed as exactly what it is.

---

## 5. Engineering depth as a switching-cost moat

The parts a fast-follower would have to rebuild, each backed by a runnable test:

- **Cross-tick, cross-outlet identity** — entity-aware tiered blocking that
  merges differently-phrased articles of one event arriving on different ticks
  from different sources (`src/pipeline/resolve.ts`; `test/pipeline/resolve.test.ts`,
  `test/pipeline/tick-e2e.test.ts`).
- **A closed, self-tuning control loop** — LLM reflection proposes only from a
  clamped vocabulary, a deterministic guard disposes, and overrides auto-revert
  after healthy ticks (`src/pipeline/reflection-policy.ts`,
  `src/pipeline/maintenance.ts`; `test/pipeline/maintenance.test.ts`).
- **A hardened safety surface** — universal input fencing, a URL output guard
  with adversarial bypass tests, a spoken-URL guard on narration, and a
  restart-safe daily spend ceiling (`src/llm/fence.ts`, `src/llm/url-guard.ts`,
  `src/llm/spend-guard.ts`; `test/llm/url-guard.test.ts`,
  `test/llm/spend-guard.test.ts`).

**Why it's defensible (and 100% true):** 66 ADRs document real bugs already
found and fixed against a live DB (a stored XSS, a data-loss race, a poll
busy-loop, stale sources). A fast-follower doesn't just need the features — they
need to re-discover the same failure modes the hard way. That accumulated,
documented hardening is a lead measured in the incidents already survived, and
it's all in `docs/adr/`.

---

## What this moat is **not** (so the claims stay honest)

- It is **not** a network effect — there is no user-to-user graph yet.
- It is **not** a legal exclusivity — the sources are public; anyone may read them.
- It is **not** a large historical archive **yet** — the time-series is real and
  accumulating, but young.

The defensibility is the sum of: irreproducible time-series (§1), a
structurally-hard-to-copy transparency workflow (§2), cheap vertical
multiplication (§3), a faster enterprise-clearance posture (§4), and documented
engineering hardening that raises the fast-follower's real cost (§5).
