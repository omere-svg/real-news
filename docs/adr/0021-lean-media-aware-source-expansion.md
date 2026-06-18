# ADR-0021: Lean media-aware source expansion — keep 2-value Region, add the Story/Signal split, adopt a media + 4-theme source set

- **Status:** Accepted — **fully implemented 2026-06-18**: the 7 Story/BOTH sources
  (`guardian`, `timesofisrael`, `knesset-votes`, `hf-papers`, `nber`, `nature`, `psyarxiv`)
  shipped 2026-06-17 behind the `SourceAdapter` seam with a shared RSS parser; the 2 SIGNAL
  sources (`wikipedia-pageviews`, `worldbank`) and the Story/Signal split (§2) shipped
  2026-06-18 — the mechanism is settled in [ADR-0025](0025-story-signal-split-numeric-signal-sources.md)
  (a companion `SignalSource` seam + a bounded partition nudge).
- **Date:** 2026-06-17
- **Deciders:** Project Horizon team

> **Implementation note.** Region stays 2-value (§1) — unchanged. Endpoints live-confirmed
> 2026-06-17. Guardian/Times of Israel/NBER/Nature ingest via keyless RSS through a shared
> `RssSource` adapter + `rss.ts` parser; HF Daily Papers, PsyArXiv (OSF JSON:API), and Knesset
> Votes (OData JSON) reuse the existing `JsonFetcher`. Research backing:
> [`../research/source-shortlist.md`](../research/source-shortlist.md) and the per-source
> sheets in [`../research/source-sheets/`](../research/source-sheets/) (parked reference).

## Context

The product is pivoting to a concrete, lean MVP: a **Telegram bot delivering news briefs to a
single user based in Israel.** That reframes the source question entirely. The earlier draft of
this ADR proposed a 10-bloc `Region` vocabulary and ~25 new `SourceId`s spanning every global
power — correct as *research breadth*, but wrong as *MVP scope*. A one-user Israel+World bot does
not need Gulf statistics, Oceania central banks, or per-bloc macro partitions on day one; it
needs a small set of high-leverage feeds that tell the user **what is happening in Israel and the
world right now**, including what **mainstream media** is covering.

So we apply 80/20: pick the few sources that carry most of the value, keep the schema minimal, and
park the long tail as documented future reference rather than code.

Phase 1 already ships 6 sources (Hacker News, arXiv, GDELT, Knesset bills, SEC EDGAR, Wikipedia)
behind the `SourceAdapter` seam (ADR-0004). The R1 research (41 candidates probed) surfaced two
structural gaps this ADR closes, plus one we explicitly defer:

- **No mainstream-media anchor.** Nothing in the current six tells the bot what the front pages
  say. The earlier shortlist PARKed wires partly on body-text/caching ToS — but that gate
  disappears if we ingest **public RSS** (headline + summary + link, syndication-intended) instead
  of caching full articles.
- **Every source is modelled as a Story source**, forcing numeric/attention feeds into the story
  list where they don't belong.
- **(Deferred)** The 10-bloc geography. Not needed for an Israel+World bot.

## Decision

### 1. `Region` stays the 2-value vocabulary: `Israel | World`

Roll back the proposed 10-bloc expansion. The schema (ADR-0005) keeps:

```
Region = Israel | World
```

`World` is the catch-all / global partition; `Israel` is the user's home region. This is exactly
the partition a single Israel-based user needs, and it keeps classification (ADR-0009) and dedup
simple. Per-bloc geography is recorded in [`../research/source-shortlist.md`](../research/source-shortlist.md)
§5 as a **future option**, to be revisited only if the product serves multiple regions.

### 2. Keep the Story vs. Signal split (it earns its place even when lean)

A Source declares one of two roles, orthogonal to its objectivity Tier:

- **Story source** → emits `RawItem`s that flow through `classify → cluster → score → analyze`
  into the `stories` read-model. (Guardian, Times of Israel, Knesset votes, USGS.)
- **Signal source** → emits **numeric series** that feed the per-cluster `Signals` (ADR-0008) as
  scoring context; never a standalone story. (Wikipedia Pageviews.)
- **BOTH** where a feed legitimately does both (Knesset vote = a record *and* a points/tone signal;
  HF Daily Paper = a story *and* an `upvotes`/comments popularity signal).

Even in a lean MVP this split pays for itself: it lets the **attention signal** (Pageviews) and the
**macro-economic signal** (World Bank) sharpen significance scoring without polluting the story feed.
The mechanism (companion seam vs. discriminated `role` field) is left to the building PR.

### 3. Adopt a media-aware, thematically-focused source set for Phase 4

Revised for the user's actual interests: **drop USGS Earthquakes** (not relevant) and add
authoritative anchors in four themes — **AI & Deep Tech, Global Economics & Markets, General
Science, Psychology & Behavioral Science** — alongside the kept core (media anchors, Knesset,
Wikipedia Pageviews, World Bank). All **keyless and legally clean to process** (RSS summaries /
open scientific APIs / open government data — no body-text caching, no key provisioning on day one).
All endpoints **live-probed 2026-06-17**.

**Kept core**

| Source (new `SourceId`) | Tier | Role | Region | What it gives the bot | Access |
|---|---|---|---|---|---|
| **Guardian** (`guardian`) | D | STORY | World | Global mainstream-media front page; section → Topic | keyless **RSS** (per-section), API later |
| **Times of Israel** (`timesofisrael`) | D | STORY | Israel | Israel-local mainstream media in English | keyless **RSS** |
| **Knesset Votes** (`knesset-votes`) | A | BOTH | Israel | Recorded for/against/abstain vote tallies | keyless OData |
| **Wikipedia Pageviews** (`wikipedia-pageviews`) | C | SIGNAL | World (he.wiki ⇒ Israel) | Cross-lingual reader-attention surges | keyless JSON |
| **World Bank** (`worldbank`) | A | SIGNAL | World | Macro-economic context (GDP/inflation/trade) | keyless JSON |

**New thematic anchors** (one per field, ✓ = HTTP 200 live-confirmed)

| Theme | Source (new `SourceId`) | Tier | Role | Topic | What it gives the bot | Access |
|---|---|---|---|---|---|---|
| **AI & Deep Tech** | **Hugging Face Daily Papers** (`hf-papers`) ✓ | B | BOTH | AI | 50 community-curated *trending* AI/ML papers/day w/ `upvotes` (points) + `numComments` (mentions) + `ai_summary` — the "what's hot in AI" ranking layer arXiv's firehose lacks | keyless JSON API |
| **Global Economics & Markets** | **NBER Working Papers** (`nber`) ✓ | A | STORY | Business | Authoritative academic economics research (title + abstract + authors); pairs with World Bank's macro Signal | keyless **RSS** |
| **General Science** | **Nature** (`nature`) ✓ | A | STORY | Science | Top-journal science research & innovation headlines + summaries | keyless **RSS** (RDF/1.0) |
| **Psychology & Behavioral Science** | **PsyArXiv** (`psyarxiv`) ✓ | B | STORY | Science | Psychology/behavioral-science preprints (title + abstract + subject tags) via the open OSF API — the arXiv of psychology | keyless JSON API |

This **overrides the earlier PARK on mainstream media** (per the product pivot): wires are admitted
via **public RSS**, where processing headline + summary + link is the intended, legal use —
sidestepping the body-text/caching ToS that gated the full Guardian *API*. The same logic covers
Nature/NBER RSS and the HF/PsyArXiv open APIs: **metadata + brief + link only, never full body**,
with attribution preserved.

**Thematic coverage achieved:** AI (`hf-papers`, plus existing arXiv) · Economics & Markets
(`nber` research + `worldbank` macro + Guardian markets coverage) · Science (`nature`) · Psychology
(`psyarxiv`) · Israel politics (`knesset-votes`) · global+local media (`guardian`, `timesofisrael`) ·
cross-topic attention (`wikipedia-pageviews`). Built on the 6 sources already running.

### 4. PARK everything else (documented reference, not MVP code)

All other previously-probed candidates remain **PARKed**: reserved as future references in
[`../research/source-shortlist.md`](../research/source-shortlist.md), **not built**. This includes:

- **USGS Earthquakes** — dropped from the active set this revision (not relevant to the user);
  slug reserved if physical-event coverage is wanted later.
- **Rest of the macro/Signal layer** (ECB, Eurostat, Frankfurter FX, CoinGecko, FRED, central
  banks) — World Bank is the one macro Signal we adopt now; the others wait for a richer scoring
  model (roadmap #9).
- **Per-bloc national portals** (data.gov.in, GCC-Stat, Stats NZ/SA, IBGE, CEPALSTAT, European
  Parliament, …) — out of scope under the 2-region schema; several geo-blocked anyway.
- **Legally restricted / blocked sources** (Reddit, ACLED, Google Trends, Bank of Israel raw
  redistribution, **IMF** — Akamai 403 on probe) — PARKed until a license/open path exists.
- **Other science depth & engagement** (OpenAlex, CrossRef, Stack Exchange, GitHub, MIT Tech
  Review & ScienceDaily RSS — viable alternates) and **Sports** (TheSportsDB) — Phase-4+ candidates.

The `SourceId` union therefore grows by **9 slugs** now — kept core (`guardian`, `timesofisrael`,
`knesset-votes`, `wikipedia-pageviews`, `worldbank`) + thematic anchors (`hf-papers`, `nber`,
`nature`, `psyarxiv`); the rest, incl. `usgs-quakes`, stay reserved on paper.

## Consequences

- **Easier:** the bot immediately knows the Israeli + global mainstream agenda *and* the research
  frontier across the user's four themes (AI, economics, science, psychology), with no API keys and
  no caching-ToS exposure; the schema stays at 2 regions; the diff is ~9 adapters, not ~25.
- **New capability needed — two parse shapes:** (a) **RSS/XML** — the current `JsonFetcher`
  (`http.ts`) is JSON-only, so Guardian, Times of Israel, NBER and Nature need an XML/RSS step
  (note Nature is RDF/RSS-1.0, a minor variant); (b) **JSON** adapters for HF Daily Papers, PsyArXiv
  (OSF JSON:API), Wikipedia Pageviews and World Bank reuse the existing fetcher. Flagged for the
  building PR (small, isolated).
- **Story/Signal split** is still a real seam change to ADR-0004 (Story-only today); deferred and
  coordinated with concurrent work, now justified by two Signal sources (Pageviews + World Bank) and
  two BOTH sources (Knesset votes, HF upvotes/comments).
- **Topic mapping:** `hf-papers`→AI, `nber`→Business, `nature`→Science, `psyarxiv`→Science
  (psychology has no dedicated `Topic`; maps to Science — revisit if a `Psychology` Topic is wanted).
- **Accepted trade-offs:** mainstream RSS feeds carry editorial selection/bias (Tier D) — mitigated
  by pairing a global (Guardian) and a local (Times of Israel) anchor plus objective-source
  corroboration; preprint sources (HF, PsyArXiv) are un-peer-reviewed — acceptable for a "frontier"
  signal, flagged as preprint in the brief. We ingest summaries only and link out.
- **Migration:** none. `Region` is unchanged; adding 9 sources is additive.

## Alternatives considered

- **The 10-bloc Region + ~25 sources (this ADR's prior draft).** Rejected for the MVP: scope far
  exceeds a single Israel-based user; retained as documented future reference in the shortlist.
- **PARK mainstream media entirely (original shortlist stance).** Rejected per the product pivot:
  a news bot must know the front pages, and **public RSS** makes that legal and keyless — the
  body-text/caching concern only applied to full-article API ingestion.
- **Use the Guardian Open Platform API now (richer metadata, section→Topic).** Deferred: needs a
  free key and raises body-storage ToS questions; RSS gives 80% of the value keyless today. Upgrade
  path noted.
- **Drop the Story/Signal split for leanness.** Rejected: it's one extra concept that immediately
  improves scoring via the attention + macro signals and unblocks the deferred macro layer without rework.
- **Thematic AI source — arXiv alone vs. Hugging Face Daily Papers.** arXiv (already a source) is a
  firehose; HF Daily Papers adds a *community-ranked* "what's hot" layer (`upvotes`/comments) the raw
  feed lacks. Adopted HF as a complement, not a replacement. MIT Tech Review RSS kept as an applied/
  industry alternate (PARKed).
- **Thematic economics source — IMF vs. NBER.** IMF's blog RSS returned **Akamai 403** on probe
  (PARKed); NBER working-papers RSS is keyless, live, and authoritatively academic — adopted, paired
  with World Bank's macro Signal.
- **Thematic science source — Nature vs. ScienceDaily/EurekAlert.** Nature chosen for signal quality
  (top-journal primary research); ScienceDaily RSS kept as a higher-volume aggregator alternate.
- **Thematic psychology source — PsyArXiv vs. ScienceDaily Mind&Brain / APS.** PsyArXiv (open OSF
  JSON:API) chosen as the primary-research preprint server mirroring our arXiv pattern; ScienceDaily
  Mind&Brain RSS kept as a popular-summary alternate.
- **Reuters / AP wires.** Reuters retired its public RSS and AP's open feeds are limited/licensed;
  the Guardian + Times of Israel RSS pair already delivers the global+local anchor legally and
  keylessly, so the wires stay PARKed until an open path appears.
