# Research Plan — Source Expansion (Phase 4 #10, accelerated)

> ⚠️ **STATUS — RESEARCH PLAN (executed). Decision lives in [ADR-0021](../adr/0021-lean-media-aware-source-expansion.md).**
> This documents the methodology and the broad candidate catalogue (incl. the per-bloc Region
> exploration and USGS). The MVP outcome — **2-value Region** + a **media + 4-theme** adopt set —
> is governed by ADR-0021; the wider catalogue here, including the **10-bloc plan** and **USGS**, is
> **parked reference**, not the build plan.

Goal: significantly grow the set of **objective, public-API, zero-scraping** sources
feeding the extraction worker — and, crucially, decide *what each one contributes to
our existing model* (`SourceMetadata` → `Signals` → significance), not just "add another feed".

This is a **research plan**, not an implementation. No code. Output is a set of per-source
spec sheets + a prioritized shortlist + one ADR amending the `SourceId` vocabulary.

Anchors: Principle 2 (strictly zero scraping — official/public/stable APIs only),
Principle 3 (Region × Topic × Relevance partitioning), ADR-0004 (pluggable adapters),
ADR-0008 (hybrid significance from verifiable signals), ADR-0009 (metadata-first classification).

---

## 1. What "a good source" means here (the rubric)

A candidate earns a slot only if we can answer all of these. Each investigation fills this sheet:

| Field | Why it matters to *us* specifically |
|---|---|
| **API surface** | Base URL, the one endpoint we'd hit, response format (JSON/Atom/OData/CKAN). Must be a documented developer API — Principle 2. |
| **Auth & cost** | None / free key / paid tier. Free-or-keyless strongly preferred (matches HN/GDELT/arXiv). Note key storage if needed. |
| **Rate limits** | Req/day, burst caps, pacing needed. Feeds the tick budget (cf. GDELT pacing, Phase 5 #11). |
| **Reliability** | Uptime reputation, stability of contract, whether it's a primary/official source or a reseller. Powers `sourceWeight`. |
| **Objectivity tier** | See §2. Determines whether output is *content* (a story) or a *signal* (scoring context only). |
| **Region mapping** | Does it assert `Israel` / `World`, or must the classifier infer it? (Knesset asserts Israel → skips LLM.) |
| **Topic mapping** | Does a native category map to our closed `Topic` set (AI/Geopolitics/Politics/Sports/Business/Science/Other)? |
| **Signal yield** | Which of `points` / `mentions` / `tone` it natively exposes — the whole reason to prefer one source over another. |
| **Dedup key** | Stable `externalId` for `(source, externalId)` idempotency. |
| **Story vs Signal** | Does it produce `RawItem`s (content) or numeric context feeding `Signals` (Phase 4 #9)? |

A source that contributes **nothing new** to the signal/partition model (e.g. a 4th generic
tech-news feed that only repeats what HN+GDELT already corroborate) is *deprioritized* — more
corroboration of the same cluster is marginal; new **independent signal axes** are valuable.

---

## 2. Objectivity tiers (the filter the user is really asking for)

The user wants "super reliable and objective." Objectivity is not binary — classify each source:

- **Tier A — Primary / official data.** Government statistics, central banks, regulators,
  scientific instruments. Facts, not framing. *Highest `sourceWeight`.* These are the spine.
  → SEC EDGAR (have), Knesset (have), World Bank, FRED, USGS, central banks, CBS Israel, data.gov.il.
- **Tier B — Neutral aggregators / metadata.** Don't editorialize; expose *measurements about*
  coverage (volume, tone, mention counts). Content may carry source bias, but the **metadata is
  objective and is exactly what we score on.** → GDELT (have), Wikipedia pageviews (have), Google Trends.
- **Tier C — Engagement / attention platforms.** Surface *what people attend to*, not truth.
  Useful strictly as a **popularity signal** (`points`/`mentions`), never as ground truth.
  → Hacker News (have), Reddit, Stack Exchange, GitHub.
- **Tier D — Editorial wires.** Reuters/AP/Guardian/NYT-style. Useful for breadth & a clean
  headline/`text`, but carry editorial selection. Admit only as corroborating content, weighted
  below Tier A/B, and lean on multi-source `corroboration` to wash out single-outlet bias.

Decision rule baked into the research: **prefer Tier A/B; admit C only as signals; admit D only
when it adds regional/topical coverage we can't get from A/B and always behind corroboration.**

---

## 3. Per-source spec-sheet template (deliverable for each candidate)

Each investigated source produces one short sheet:

```
Source: <name>            SourceId: <proposed-slug>      Tier: A/B/C/D
Endpoint: <method + URL we'd call>            Format: JSON/Atom/OData/CKAN
Auth: none | free-key | paid                  Rate limit: <n/day, pacing>
Region: asserts Israel|World | infer          Topic: native→our Topic map | infer
Signals yielded: points? mentions? tone?       externalId: <field>
Role: STORY (RawItem) | SIGNAL (Signals ctx)
Verdict: ADOPT / TRIAL / PARK + one-line why (what NEW axis it adds)
Risks: contract stability, rate cap, licensing/ToS for storage
```

---

## 4. Candidate catalog (grouped by the *role* they'd play)

> Ordered so the highest-objectivity, highest-new-signal candidates come first.
> "✦ new axis" flags a source that adds something our current 6 cannot.

### 4A. Attention / trend signals (Tier B/C) — answer "what is the world looking at *now*"
These are the user's "Google Trends → trends on required field" intuition. They mostly feed
**Signals** and topic-demand, not standalone stories.

- **Google Trends** (Tier B) ✦ — daily/real-time trending queries + interest-over-time, filterable
  by **geo (IL vs US/World)** and category. Yields a demand/`points`-like attention score and is a
  natural **Region+Topic** demand signal. *Research: official Trends API access vs. the unofficial
  endpoint; ToS for storage; how to bucket queries into our Topics.*
- **Wikipedia pageviews / "most-viewed"** (Tier B) ✦ — we already pull Wikipedia *content*; the
  **Pageviews API** + daily top-articles is a clean, keyless objective **attention signal** (spikes =
  significance). Per-language (he.wikipedia → Israel signal). Low-hanging given we already speak this API.
- **Reddit** (Tier C) — subreddit `top`/`hot` JSON gives `points` (score) + `mentions` (num_comments).
  Maps cleanly to our metadata. Subreddit → Topic/Region mapping (r/israel, r/worldnews, r/MachineLearning).
  *Risk: auth/OAuth now required; rate limits tightened — check current ToS.*
- **Stack Exchange** (Tier C) — API gives question score + view/answer counts → AI/Science demand signal. Keyless tier exists.
- **GitHub** (Tier C) ✦ — search/trending repos by stars-velocity → a leading **AI/Science** signal
  (what devs are adopting before it's news). Stars/forks → `points`/`mentions`.
- **YouTube Data API — mostPopular** (Tier C) — trending by region/category; engagement counts.
  *Risk: quota cost, key required; weigh vs. value.*

### 4B. Objective / official Israel sources (Tier A) — deepen the `Israel` partition
Currently Israel = Knesset only. This is the thinnest, highest-value partition to widen.

- **data.gov.il (CKAN API)** (Tier A) ✦ — already named in the vision & roadmap. CKAN
  `datastore_search` / `package_search` over hundreds of official IL datasets. Region=Israel asserted.
  *Research: which datasets are time-series/event-like enough to be "news" vs. static reference.*
- **Bank of Israel** (Tier A) ✦ — FX rates, rates decisions, releases. Numeric **Business** signal for Israel.
- **CBS — Israel Central Bureau of Statistics** (Tier A) — official stats releases API/feed; Region=Israel, Topic=Business/Politics.
- **Knesset OData — beyond bills** (Tier A) — the same `ParliamentInfo.svc` exposes votes, committee
  sessions, members, queries. *Note:* the user's "highest comments/likes" expectation does **not** exist
  in Knesset OData — it's legislative records, not a social feed. **Real engagement-of-IL-politics**
  signal must come from Reddit r/israel / Google Trends IL / he.wikipedia pageviews, not Knesset.
- **Oref / Home Front Command** (Tier A) ✦ — official alerts feed; high-significance Israel security events.
  *Research: stable public endpoint + ToS; this is sensitive — handle carefully.*

### 4C. Numeric macro signals (Tier A) — Phase 4 #9 "Signals", not stories
These feed significance *context*, not the story list. High objectivity, very stable contracts.

- **World Bank Open Data** (Tier A) ✦ — keyless JSON, global indicators. Already in roadmap (#9).
- **FRED — St. Louis Fed** (Tier A) ✦ — US/global economic time series; free key. Business signal backbone.
- **IMF / ECB / OECD** (Tier A) — official macro series; stable. Pick one to start (ECB SDW is keyless).
- **Frankfurter / exchangerate.host** (Tier B) — keyless FX (ECB-derived); cheap Business signal.
- **CoinGecko** (Tier B/C) ✦ — keyless crypto market data + trending coins → Business/AI-adjacent signal.
- **USGS Earthquakes** (Tier A) ✦ — keyless GeoJSON real-time feed; objective high-significance **Geopolitics/Science** events with magnitude → a natural raw significance signal.

### 4D. Geopolitics / global events (Tier A/B) — corroborate GDELT with primary sources
- **ReliefWeb (UN OCHA) API** (Tier A) ✦ — official humanitarian/disaster reports; keyless; Region+Topic clean.
- **GDACS** (Tier A) — global disaster alerts feed (severity-scored) → significance directly.
- **ACLED** (Tier A) — conflict/event data (key, possibly gated) → Geopolitics. *Research licensing for storage.*
- **UN / OWID datasets** (Tier A) — supporting context signals.

### 4E. Science / academia (Tier A/B) — corroborate & broaden arXiv
- **CrossRef** (Tier A) ✦ — keyless metadata for *all* DOIs (beyond arXiv's preprints) → Science breadth + citation counts as `points`.
- **OpenAlex** (Tier A) ✦ — keyless; works/topics/citations; "trending concepts" → AI/Science signal.
- **PubMed / NCBI E-utilities** (Tier A) — biomedical Science coverage; free key.
- **NASA APIs / Semantic Scholar / CORE** (Tier A/B) — niche Science breadth; evaluate marginal value.

### 4F. Sports (Tier A/B) — currently zero coverage of the `Sports` Topic
- **TheSportsDB** (Tier B) ✦ — keyless/free events, scores → Sports stories with Region inferable.
- **football-data.org** (Tier A/B) — free tier, structured fixtures/results.
- **API-Football / ESPN public endpoints** — broader but key/quota or ToS concerns; evaluate vs. need.

### 4G. Editorial wires (Tier D) — only if breadth gaps remain after A–F
- **The Guardian Open Platform** (Tier D) ✦ — free key, full article API, clean sections→Topic map, well-documented & stable.
- **NYT APIs** (Tier D) — Top Stories/Most Popular; free key; "Most Popular" gives an engagement signal.
- **NewsAPI / Mediastack / Currents / TheNewsAPI** (Tier D) — aggregators; free tiers are limited & some forbid storage — check ToS hard before adopting.
- **AP / Reuters** — most authoritative wires but typically commercial/gated; document cost.

### 4H. Global-power & regional macro / geopolitical coverage (Tier A/B) ✦ — extend the Region partition
Currently Region = `Israel` / `World` only. To give each major power its own objective primary-source
signal, the Region vocabulary extends (see §4.1). Each row is a primary statistics office, central bank,
or neutral aggregator — **facts, not framing.** Most are *Signal* sources (macro indicators) plus some
*Story* feeds (legislative/official releases).

**China** (→ Region `China`)
- **National Bureau of Statistics of China (NBS)** (Tier A) — official macro indicators. *Research: is
  there a documented JSON API vs. only data portal exports; stability & access from outside CN.*
- **World Bank / IMF / OECD country = China** (Tier A) ✦ — keyless, neutral third-party macro on China;
  the **reliable fallback** if NBS lacks a clean API. Strongly preferred for objectivity.
- **GDELT filtered to China** (Tier B) — coverage volume/tone signal (already integrated source, new slice).

**India** (→ Region `India`)
- **Open Government Data (OGD) Platform India — data.gov.in** (Tier A) ✦ — official CKAN-style API,
  free key. Hundreds of datasets; India asserted. Pattern mirrors data.gov.il.
- **Reserve Bank of India (RBI)** (Tier A) — rates/FX/releases → Business signal.
- **World Bank/IMF country = India** (Tier A) — neutral macro fallback.

**European Union** (→ Region `EU`)
- **Eurostat API** (Tier A) ✦ — official EU statistics, keyless JSON (SDMX/JSON-stat). Macro signal backbone for EU.
- **European Parliament Open Data Portal** (Tier A) ✦ — legislative activity, MEPs, votes → Politics *stories*.
- **ECB Statistical Data Warehouse** (Tier A) — keyless rates/FX → Business signal (also serves global).
- **EU Open Data Portal (data.europa.eu)** (Tier A) — broad dataset catalogue; pick event-like series.

**Africa** (→ Region `Africa`)
- **African Development Bank — Data Portal API** (Tier A) ✦ — continental macro indicators.
- **UN OCHA / ReliefWeb** (Tier A) ✦ — regional stability / humanitarian signals (also in §4D); strong for Africa.
- **South Africa — data.gov.za / Stats SA** (Tier A) — most mature national open-data portal on the continent.
- **World Bank Africa slice** (Tier A) — neutral macro fallback where national APIs are thin/unstable.

**Middle East — excluding Israel** (→ Region `MiddleEast`)
- **UAE — Bayanat / Open Data Portal** (Tier A) ✦ — official datasets.
- **Saudi Arabia — Open Data Portal (data.gov.sa)** (Tier A) — official; *research API surface vs. portal-only.*
- **GCC-Stat (GCC Statistical Centre)** (Tier A) ✦ — regional Gulf statistics aggregator.
- **World Bank / IMF MENA slice** (Tier A) — neutral fallback; recommended baseline given uneven national APIs.

**Australia & New Zealand** (→ Region `Oceania`)
- **data.gov.au (Australian Government)** (Tier A) ✦ — CKAN API, mature, keyless reads.
- **Stats NZ API** (Tier A) ✦ — official NZ statistics API.
- **Reserve Bank of Australia / RBNZ** (Tier A) — rates/FX → Business signal.

**South America** (→ Region `LatinAmerica`)
- **UN ECLAC / CEPALSTAT (CEPAL) API** (Tier A) ✦ — pan-Latin-American macro indicators; ideal single aggregator.
- **Brazil — dados.gov.br + IBGE API** (Tier A) ✦ — official Brazilian open data + statistics; IBGE has a documented API.
- **World Bank LatAm slice** (Tier A) — neutral fallback for countries without clean national APIs.

> **Cross-cutting fallback rule:** where a national API is undocumented, unstable, or access-restricted
> from outside the country, default to the **neutral third-party aggregator** (World Bank / IMF / OECD /
> GDELT slice) for that region. This preserves objectivity and contract stability (Principle 2) while
> still giving the region its own partition and signal.

### 4.1. Region vocabulary change (ADR required)
Adopting §4H means extending the closed `Region` type beyond `Israel` / `World`. Proposed set:
`Israel`, `US`, `China`, `India`, `EU`, `MiddleEast`, `Africa`, `LatinAmerica`, `Oceania`, `World`
(`World` remains the catch-all when the classifier can't place an item). This is a schema + classifier
change and is recorded in the wave-2 ADR (§6) — *not* free text. Open question for R0: granularity —
per-country vs. per-bloc. Recommendation: **per-bloc** to start (fewer partitions, matches available
aggregators), splitting out a country only when it earns its own primary-source feed (China, India).

---

## 5. Research methodology (how we actually run this)

Time-boxed, parallelizable. Each source is independent → investigate in parallel, converge on a shortlist.

**Phase R0 — Frame (½ day).** Lock the rubric (§1) and tiers (§2). Confirm the *gaps* we're filling
from the roadmap: Israel partition is thin (only Knesset), Sports = 0, no numeric Signals yet, no
explicit trend/attention axis. Rank gaps by value → that ranks the catalog.

**Phase R1 — Desk survey (1–2 days).** For every §4 candidate, fill the spec sheet from official
docs only. Verify with **one real probe call** (curl) per source: confirm endpoint, auth, response
shape, a usable `externalId`, and which signal fields are actually present (docs lie; responses don't).
Record rate limits and any ToS clause about *storing* responses (we cache to SQLite — storage rights matter).

**Phase R2 — Map to model (½ day).** For each survivor, write the concrete mapping:
`response field → RawItem/SourceMetadata field`, native category → our `Topic`, region assertion,
and Story-vs-Signal classification. Flag any that need a `Topic`/`Region` vocabulary change (that's an ADR).

**Phase R3 — Score & shortlist (½ day).** Score each survivor on: objectivity tier, new-axis value,
keyless/free, contract stability, rate headroom, implementation cost (does it fit the existing
`SourceAdapter` shape like Knesset, or need a new sub-pattern e.g. Signals vs Stories). Produce a
ranked **Adopt / Trial / Park** list.

**Phase R4 — Decide (½ day).** One ADR: "Source expansion — wave 2", listing adopted sources, the
amended `SourceId` union, and — if we add the Signals-vs-Stories distinction — how numeric sources
plug into ADR-0008 scoring rather than the story list. Update `docs/ROADMAP.md` items #9/#10.

> Optional accelerator: R1 is embarrassingly parallel (≈20 sources). Can fan out one investigator per
> source to fill spec sheets concurrently, then converge at R2. Say the word and I'll run it as a workflow.

---

## 6. Output artifacts

1. **`docs/research/source-sheets/<id>.md`** — one filled spec sheet per investigated source.
2. **Shortlist table** — Adopt / Trial / Park, ranked, with the one-line "new axis" justification.
3. **One ADR** — amends `SourceId` **and the `Region` vocabulary** (§4.1), records the Story-vs-Signal split if introduced, links roadmap #9/#10.
4. **Roadmap update** — move adopted items out of the Phase 4 backlog.

---

## 7. My recommended first wave (hypothesis, to be confirmed in R1)

Biggest objective-signal-per-unit-effort, filling the real gaps:

1. **data.gov.il (CKAN)** — named in the vision; widens the thin Israel partition; Tier A. ✦
2. **Google Trends** — the explicit attention axis we lack; Region+Topic demand; Tier B. ✦
3. **Wikipedia pageviews** — near-free (we own the API already); objective spike signal; Tier B. ✦
4. **World Bank + FRED** — stand up the Signals concept (Phase 4 #9) with two rock-solid Tier-A feeds. ✦
5. **USGS earthquakes + ReliefWeb** — primary-source high-significance global events; Tier A. ✦
6. **TheSportsDB** — opens the untouched Sports Topic; keyless; Tier B. ✦
7. **Reddit (r/israel, r/worldnews, r/MachineLearning)** — pure popularity signal (`points`+`mentions`); Tier C.

Parked until needed: editorial wires (Guardian/NYT) — only if A–C leave coverage gaps, and always
behind corroboration to neutralize editorial bias.
