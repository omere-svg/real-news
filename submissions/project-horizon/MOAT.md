# MOAT — Project Horizon

**Thesis.** The news market is crowded with feeds that optimize for engagement and
labelers that tag bias after the fact. None of them do the one thing an executive
actually wants: rank the world's events by *real-world consequence*, show the
arithmetic, and prove it across many sources. Horizon does — and the way it does
it compounds into advantages a fast-follower cannot simply copy on day one.

Two kinds of moat run through this document, and they are kept strictly separate:

- **Moats that are real today** (§1–§5) — each is verifiable from the repo, the
  live deployment, or the running DB right now.
- **Moats that activate once we have users** (§6) — clearly labeled as future.
  We have **zero external users today**; §6 is the plan, not a present claim.

Where something is a *posture* rather than a *guarantee*, it says so. This
document exists so a judge can *check* the moat, not take it on faith.

---

## The beachhead: high-stakes, multi-source news where "no agenda" is the product

Horizon's ingest already leans into a defensible wedge: fast-moving,
consequence-heavy stories that are covered by *many outlets at once* (geopolitics,
Israel/Middle East, markets, AI). That is precisely the segment where a single
outlet's agenda is most distorting and where cross-outlet corroboration is most
valuable — so the product's core behavior (merge the same event across sources,
rank by impact, show the math) is worth the most exactly where we start. A
horizontal "all news" reader treats every story the same; Horizon wins the
segment where getting the ranking *right and provable* actually matters, then
expands out from there (§3 explains why expansion is nearly free).

---

## 1. A compounding data asset: time-series that cannot be backfilled

Horizon persists two kinds of history that accrue only by running, tick after
tick, and can never be reconstructed after the fact:

- **Signal history** — per-tick readings of reader attention, news tone, market
  volatility, and citation impact from independent signal sources, retained 365
  days. Live proof: the `oldestSignalAt` and signal-observation counters at
  `https://horizon-news.duckdns.org/api/stats`.
- **Corroboration *timing* per story** — the pipeline records *when* each
  additional source corroborated a developing event, tick by tick. That "how
  fast did coverage converge, and who was first" series is a byproduct of
  continuous operation and exists nowhere else.

**Why it's defensible (and literally true):** a competitor can clone the code and
today's story table, but they cannot clone *yesterday*. Time-series has no
backfill path — you either were running and recording on a given day or you were
not. Every day Horizon runs, this gap widens automatically and for free. It is
directly inspectable: `/api/stats` shows the counters climbing over the
deployment's lifetime.

**Honest boundary:** the archive today is young (production has run since
2026-07-07). The claim is that the *mechanism* is real and already accumulating —
not that the archive is large yet. The moat here is the slope, and the slope is
already positive.

---

## 2. A transparency workflow incumbents structurally cannot copy

- **What Horizon does:** shows the *arithmetic* behind every rank — an additive,
  named `ScoreBreakdown` rendered verbatim on both web and Telegram
  (`src/presentation/score-explanation.ts`), impact-scaled so prestige or
  popularity alone can't outrank a mass-casualty event.
- **What incumbents do:** engagement-ranked feeds (the ad-funded majority) and
  provenance/bias labelers (Ground News, Particle) — all still pull-and-read,
  none expose *why* a story ranks where it does as inspectable math.

**Why it's defensible:** an engagement-ranked incumbent literally cannot publish
"here is the arithmetic behind this rank" without revealing that the arithmetic
optimizes for time-on-page, not consequence. Transparency isn't a feature they're
behind on — it's one their business model structurally disallows. This is a
positioning moat, not a patent, and is stated as such.

---

## 3. Vertical multiplication: a new market is a config file, not a rewrite

A tenant is a YAML config + a database, both env-driven in `src/main.ts`
(`HORIZON_CONFIG`, `DB_URL`), so a second independent tenant runs with no code
change:

```
HORIZON_CONFIG=config/alt.yaml DB_URL=file:./data/horizon-alt.db npm start
```

**Proof the seam is real:** `test/config/load.test.ts` loads and validates
`config/alt.yaml` against the same schema the primary instance uses; `alt.yaml`
enables keyless sources against a separate SQLite file, so it needs no API keys.
The tenant boundary is a seam exercised by a test, not a marketing bullet.

**Why it compounds the other moats:** a vertical tenant (legal-news, biotech,
energy-policy) inherits the entire scoring / cross-outlet-merge / self-tuning
agent engine and supplies only its own source list + weights. The cost to stand
up a *defensible* vertical is one config file — which means the irreproducible
time-series of §1 and the future user-data moat of §6 can be replicated across
many verticals without re-engineering the hard parts.

---

## 4. Procurement posture as a go-to-market wedge

Every enabled source is a documented public API or public RSS/XML feed; none
require scraping HTML or auth beyond an optional free demo key (full per-source
table in `EVIDENCE.md → Source terms`).

**Why it's a wedge (stated honestly):** this is **not** a legal shield and this
document does not claim one. It is a *procurement* advantage — a B2B legal review
clears an official-API-only ingestion path faster than a scraper-based
competitor's, shortening enterprise sales cycles. For a paid B2B product, "we
pass legal review faster" is a real, checkable edge, framed as exactly what it is.

---

## 5. Engineering depth as a switching cost

The parts a fast-follower would have to rebuild, each backed by a runnable test:

- **Cross-tick, cross-outlet identity** — entity-aware tiered blocking that merges
  differently-phrased articles of one event arriving on different ticks from
  different sources (`src/pipeline/resolve.ts`; `test/pipeline/resolve.test.ts`,
  `test/pipeline/tick-e2e.test.ts`).
- **A closed, self-tuning control loop** — LLM reflection proposes only from a
  clamped vocabulary, a deterministic guard disposes, and overrides auto-revert
  after healthy ticks (`src/pipeline/reflection-policy.ts`,
  `src/pipeline/maintenance.ts`; `test/pipeline/maintenance.test.ts`).
- **A hardened safety surface** — universal prompt-injection fencing, a URL output
  guard with adversarial bypass tests, a spoken-URL guard on narration, and a
  restart-safe daily spend ceiling (`src/llm/fence.ts`, `src/llm/url-guard.ts`,
  `src/llm/spend-guard.ts`; `test/llm/url-guard.test.ts`,
  `test/llm/spend-guard.test.ts`).

**Why it's defensible:** 66 ADRs document real bugs already found and fixed
against a live DB (a stored XSS, a data-loss race, a poll busy-loop, stale
sources). A fast-follower doesn't just need the features — they need to
re-discover the same failure modes the hard way. That accumulated, documented
hardening is a lead measured in incidents already survived, and it's all in
`docs/adr/`.

---

## 6. The future moat: proprietary user data, taste, and community (once we have users)

> **This section is explicitly forward-looking. Horizon has zero external users
> today, so none of the value below exists yet. It is listed here because the
> plumbing already exists and the payoff, once users arrive, is the strongest
> moat of all — a data + network moat that stacks on top of §1–§5.**

The mechanism is already built; only the users are missing:

- **Preference sync is live plumbing, not proprietary value yet.** A reader who
  links Telegram gets their topics and reading time synced across web and bot
  (ADR-0040, `src/telegram/…`, `/api/preferences`). This is the seed of a
  per-user profile — but it carries no defensive value until real users fill it,
  which is exactly why we classify it as *future*.

Once there is a user base, three data moats compound — and none can be bought or
backfilled by a competitor:

1. **Revealed interest data.** What each reader actually opens, ignores, expands
   for "why it matters," and returns to — a proprietary map of what genuinely
   matters to real people, per topic and per segment. This directly sharpens
   ranking in a way a competitor with no users cannot replicate.
2. **Reader feedback and comments (planned).** Structured signals ("this ranked
   too high," "this source was wrong," corrections, comment threads) become
   labeled training data for the scoring model — a human-in-the-loop dataset that
   improves the core product the more it's used. This is the classic data
   flywheel: more users → better ranking → more users.
3. **Community and switching cost.** Saved memory, personalized briefs, and
   eventually reader-to-reader discussion create a per-user history that doesn't
   travel to a competitor. That's where a genuine network effect and a real
   switching cost appear — neither of which exists today, and both of which are
   honestly out of scope for the current build.

**Why it belongs in a moat document even though it's future:** because the two
hard prerequisites are already done. The personalization data-model and sync are
built (ADR-0040), and the scoring engine is already a transparent, tunable
function (§2, §5) ready to consume feedback as a signal. The only missing input
is users — so this is a moat we are *positioned* to capture, not one we are
inventing from scratch.

---

## What this moat is **not** (so the claims stay honest)

- It is **not** a network effect *today* — there is no user-to-user graph yet (see §6).
- It is **not** legal exclusivity — the sources are public; anyone may read them.
- It is **not** a large historical archive *yet* — the time-series is real and
  accumulating, but young.
- The user-data flywheel of §6 does **not** exist yet — it is explicitly future.

**The defensibility today** is the sum of an irreproducible and widening
time-series (§1), a transparency workflow incumbents structurally can't copy (§2),
near-free vertical multiplication (§3), a faster enterprise-clearance posture (§4),
and documented engineering hardening that raises a fast-follower's real cost (§5).
**The defensibility tomorrow** adds the strongest layer of all — a proprietary
user-data and community flywheel (§6) built on plumbing that already ships.
