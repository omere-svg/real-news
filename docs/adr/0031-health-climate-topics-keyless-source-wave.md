# ADR-0031: Add Health + Climate Topics and a keyless source wave (Sports, Health, Climate, macro signals)

- **Status:** Accepted — **pending implementation** (decision approved 2026-06-28; sources/topics to be built TDD behind existing seams)
- **Date:** 2026-06-28
- **Deciders:** Project Horizon team

> Builds on [ADR-0021](0021-lean-media-aware-source-expansion.md) (lean media-aware expansion) and
> [ADR-0025](0025-story-signal-split-numeric-signal-sources.md) (Story/Signal split). All sources here
> are **keyless, caching-legal, zero-scraping** — the same bar ADR-0021 set. Research backing:
> [`../research/source-shortlist.md`](../research/source-shortlist.md) and the per-source sheets in
> [`../research/source-sheets/`](../research/source-sheets/) — incl. the two new sheets `nasa-eonet.md`
> and `who-outbreaks.md` (live-probed 2026-06-28).

## Context

The bot covers AI, Israel, geopolitics, business, science, and politics, but two structural gaps
remain against any mainstream news taxonomy (BBC/Reuters/Guardian/AP/NYT top-level sections):

1. **`Sports` is a declared Topic with zero sources** ([CONTEXT.md](../../CONTEXT.md), `TOPICS` in
   `src/domain/types.ts`). The vocabulary promises a field the pipeline can never populate.
2. **No `Health` and no `Climate/Environment` axis** — both are first-class current-affairs fields
   with objective, keyless primary sources available (WHO, NASA, USGS), so they clear the Tier-A/B
   objectivity bar without the editorial-bias concerns that gate wires.

The earlier research (41 candidates, [`source-shortlist.md`](../research/source-shortlist.md)) already
PARKed a set of clean keyless feeds — TheSportsDB, USGS, GDACS, CoinGecko, Frankfurter, OpenAlex —
"Phase-4+ candidates". This ADR un-parks the subset that fills the gaps above with **no API keys and
no ToS blockers**, and adds two newly-probed Tier-A feeds (NASA EONET, WHO).

Explicitly **out of scope** (rejected for this wave): `Technology` (general) and `Culture/Entertainment`
Topics — HN already covers general tech, and entertainment is largely subjective, clashing with the
objective-source character. Keyed/approval sources (ReliefWeb appname, PubMed, ECB/Eurostat) are
deferred to a later wave to keep this one friction-free.

## Decision

### 1. Extend the `Topic` vocabulary by two values

```
Topic = AI | Geopolitics | Politics | Sports | Business | Science | Israel
      | Health      (NEW)
      | Climate     (NEW)
      | Other
```

`TOPICS` in `src/domain/types.ts` is the single source of truth — the classifier prompt, feedback/prefs
parsing, and config `preferredTopics` all derive from it, so the change propagates without per-call edits
(ADR-0009/0026/0030). `Health` = public-health/medicine/outbreaks; `Climate` = natural disasters,
environment, energy/climate events. `Sports` is unchanged (already present) — it just gains a source.

### 2. Adopt a keyless source wave (all caching-legal, zero-scraping)

| Source (new `SourceId`) | Tier | Role | Topic | Access | New axis |
|---|---|---|---|---|---|
| **TheSportsDB** (`thesportsdb`) | C | STORY | Sports | keyless (key `3`; caching allowed by ToS) | Activates the empty Sports Topic |
| **WHO Disease Outbreak News** (`who-outbreaks`) | A | STORY | Health | keyless OData JSON | Authoritative outbreak feed → Health |
| **NASA EONET** (`nasa-eonet`) | A | STORY (+magnitude signal) | Climate | keyless JSON | Real-time natural-event feed → Climate |
| **USGS Earthquakes** (`usgs-quakes`) | A | BOTH (magnitude) | Climate | keyless GeoJSON | Physical-event ground truth w/ severity |
| **GDACS** (`gdacs`) | A | STORY (severity) | Climate | keyless RSS/GeoJSON | Disaster root-events upstream of media |
| **CoinGecko** (`coingecko`) | C | SIGNAL | Business | keyless (attribution required) | Crypto price/trend momentum signal |
| **Frankfurter FX** (`frankfurter`) | B | SIGNAL | Business | keyless | Daily ECB-derived FX context signal |
| **OpenAlex** (`openalex`) | B | BOTH (citations) | Science | keyless | Normalized science-impact signal beyond arXiv |

The `SourceId` union grows by 8 slugs (5 Story/BOTH, 3 Signal — split per ADR-0025). All reuse existing
seams: RSS via the shared `rss.ts` parser (GDACS); OData/JSON via `JsonFetcher` (WHO mirrors Knesset);
GeoJSON via `JsonFetcher` (USGS, EONET); Signal sources via the `SignalSource` seam (CoinGecko,
Frankfurter, OpenAlex). No new parse shape required.

### 3. Topic assertions (metadata-first, ADR-0009)

`thesportsdb`→Sports, `who-outbreaks`→Health, `nasa-eonet`/`usgs-quakes`/`gdacs`→Climate are asserted by
the adapter (skip the classifier). `openalex`→Science. Signal sources carry their Topic on the
observation (ADR-0025). Quakes appear in both EONET and USGS → dedup by event, prefer USGS for quakes.

## Consequences

- **Easier:** every Topic in the vocabulary now has at least one feed; the bot covers Sports, Health, and
  Climate with objective Tier-A/B primary sources; still no API keys, no caching-ToS exposure, no scraping.
- **Signal depth:** CoinGecko + Frankfurter + OpenAlex sharpen Business/Science significance via the
  ADR-0025 nudge without polluting the story list. EONET/USGS magnitude is a native severity signal.
- **Harder / accepted trade-offs:** (a) TheSportsDB is community-maintained (Tier C) with null engagement
  fields on free tier — STORY-only, low scoring weight; (b) WHO must request `$orderby=PublicationDate desc`
  (default is oldest-first) and strip HTML `Overview`; (c) EONET `description` is often null — rely on
  title+category + the deterministic summary fallback; (d) quake overlap EONET↔USGS needs event dedup;
  (e) CoinGecko requires "Data provided by CoinGecko" attribution in the UI.
- **Migration:** additive. Two new `Topic` values + 8 `SourceId` slugs + config entries. No schema migration
  to stored rows (Topic is a string column); existing stories keep their topics.

## Alternatives considered

- **Add `Technology` and `Culture/Entertainment` Topics too.** Rejected this wave: HN already carries
  general tech, and entertainment is largely subjective — neither has a clean Tier-A/B keyless source, so
  both clash with the objective-source character. Revisit if a strong objective feed appears.
- **Keyed/approval sources now (ReliefWeb, PubMed, ECB, Eurostat, FRED, NYT).** Deferred: each adds a key
  or approval step (ReliefWeb appname has days-to-weeks lead time). Staged as a later wave so this one stays
  keyless and shippable today.
- **ESPN undocumented endpoints for Sports.** Rejected: unofficial/undocumented = scraping-adjacent, no
  SLA — violates Principle 2. TheSportsDB is a documented keyless API that explicitly permits caching.
- **Google Trends / Reddit for attention signals.** Rejected (already PARKed): no official API + caching
  forbidden (Trends); AI/ML + bulk-caching prohibited (Reddit) — both fail Principle 4.
- **Fold Climate into Science / Geopolitics instead of its own Topic.** Rejected: climate/disasters are a
  distinct high-volume current-affairs axis with their own dedicated objective feeds (EONET/USGS/GDACS);
  a first-class Topic lets users follow or mute it independently (ADR-0026).
