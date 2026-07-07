# Source Expansion — Wave-2 Shortlist (Phase R1 results)

> ⚠️ **STATUS — RESEARCH RECORD, narrowed by [ADR-0021](../adr/0021-lean-media-aware-source-expansion.md).**
> This is the full breadth-first exploration; it is **not** the build plan. The actual MVP decision
> keeps a **2-value Region (`Israel | World`)** and adopts a **media + 4-theme** source set. The
> **per-bloc Region plan** and several entries here (incl. **USGS Earthquakes**) are **PARKed /
> deferred** — kept below for reference only. For what to build, read ADR-0021.

Synthesis of 41 probed candidates (per-source spec sheets have been archived out of the repo).
Probed read-only, 2026-06-17. Verdicts below are the *research* verdicts; the *build* set is ADR-0021's.
Probe outcomes: 32 LIVE-CONFIRMED · 5 DOCS-ONLY · 4 FAILED.

---

## 0. The two things to read first

**A. The neutral-fallback rule validated itself.** Every *national* primary portal we tried for a
non-Western bloc was geo-blocked or WAF-walled from outside the country — **China NBS, AfDB, UAE
Bayanat, Saudi data.gov.sa all FAILED (403 / WAF / TCP timeout).** In each case the **World Bank /
IMF neutral slice answered fine.** So: anchor China/Africa/MENA macro on World Bank; treat national
portals as bonus, not baseline.

**B. A caching product hits ToS walls Principle 4 must respect.** Project Horizon *caches everything*
— several otherwise-attractive sources legally restrict exactly that. These need a license decision
before adoption, not just an adapter (see §4). Most severe: **Google Trends** (no official API + ToS
forbids caching), **Reddit** (ToS forbids AI/ML + bulk caching), **ACLED** (commercial aggregator =
paid license), **Bank of Israel** (no-redistribution without written consent).

---

## 1. ADOPT (18) — confirmed, additive, build first

Ranked by objective-signal-per-effort. ✓=LIVE-confirmed. Signals = points/mentions/tone yielded.

| # | Source | Tier | Role | Region | Signals | New axis (1-line) | Watch |
|---|---|---|---|---|---|---|---|
| 1 | **World Bank** ✓ | A | SIGNAL | World/all blocs | – | Neutral macro anchor for every bloc incl. China/Africa/MENA | data latency |
| 2 | **USGS Earthquakes** ✓ | A | BOTH | World | pts·men | Real-time physical-event ground truth w/ severity | feed revisions |
| 3 | **GDACS** ✓ | A | STORY | World | pts·tone | Disaster root-events upstream of media coverage | unversioned URL |
| 4 | **GDELT per-region slices** ✓ | B | SIGNAL | World | men·tone | Cross-region tone/framing-gap on same query | already integrated |
| 5 | **Wikipedia Pageviews** ✓ | C | SIGNAL | World (he=IL) | pts | Cross-lingual reader-attention surges | 200 req/min cap |
| 6 | **ECB SDW** ✓ | A | SIGNAL | EU/World | – | Authoritative EUR rates/FX stress signal | SDMX key syntax |
| 7 | **Eurostat** ✓ | A | SIGNAL | EU | – | Official EU-27 macro at member-state resolution | – |
| 8 | **European Parliament Open Data** ✓ | A | STORY | EU | – | EU legislative votes/procedures | tallies in linked XML |
| 9 | **Frankfurter FX** ✓ | B | SIGNAL | World | – | Daily ECB FX context, keyless | single-maintainer → self-host |
| 10 | **Knesset Votes & Committees** ✓ | A | BOTH | Israel | pts·tone | Recorded for/against/abstain vote tallies | Hebrew; separate OData root |
| 11 | **CEPALSTAT (UN ECLAC)** ✓ | A | SIGNAL | LatinAmerica | – | Only pan-LatAm macro indicator feed | ToS redistribution ⚠ |
| 12 | **Brazil IBGE** ✓ | A | STORY | LatinAmerica | – | First Tier-A LatAm news (stats-agency releases) | PT locale parsing |
| 13 | **OpenAlex** ✓ | B | BOTH | World | pts | Normalized science citation-impact graph | credit-based since 2024 ⚠ |
| 14 | **CoinGecko** ✓ | C | SIGNAL | World | pts | Crypto trending/price momentum | attribution required |
| 15 | **World Bank — China slice** ✓ | A | SIGNAL | China | – | Neutral China macro (NBS geo-blocked) | dedup vs #1 |
| 16 | **ReliefWeb (UN OCHA)** (docs) | A | STORY | Africa/MENA | – | UN humanitarian/conflict depth for Africa+MENA | appname approval, 1k/day |
| 17 | **The Guardian Open Platform** ✓ | D | STORY | World | tone | Parsed editorial articles w/ section→Topic + body | body-storage ToS grey ⚠ |
| 18 | **Bank of Israel** ✓ | A | SIGNAL | Israel | – | Sovereign IL central-bank rates/FX | no-redistribution ToS ⚠ |

---

## 2. TRIAL (15) — adopt with a caveat / needs a key / scoped pilot

| Source | Tier | Role | Region | Why TRIAL not ADOPT |
|---|---|---|---|---|
| **data.gov.il (CKAN)** ✓ | A | STORY | Israel | Strong, but Hebrew metadata + heavy dedup overlap w/ Knesset → scope to non-Knesset datasets |
| **FRED** (docs) | A | SIGNAL | US | Free key required; large overlap w/ World Bank on non-US series → take only US high-freq series |
| **GitHub trending** ✓ | C | BOTH | World | Real signal but viral-noise; needs min-stars/desc guards + token for 30 req/min |
| **Stack Exchange** ✓ | C | BOTH | World | Good practitioner-demand signal; CC BY-SA share-alike needs legal review; key for volume |
| **CrossRef** ✓ | B | SIGNAL | World | Citation signal lags (new DOIs start at 0); pair with arXiv, not standalone |
| **NYT Top/Most Popular** (docs) | D | BOTH | US | "Most Popular" = rare mass-readership signal; ToS limits bulk caching → metadata only |
| **ACLED** (docs) | B | STORY | World | Best conflict resolution, but **commercial aggregator needs paid license** + free tier 12-mo lag |
| **Google Trends** ✓ | C | SIGNAL | World | **No official API; ToS forbids caching** — conflicts w/ Principle 2 & 4. Pilot only if legal clears |
| **TheSportsDB** ✓ | C | STORY | World | Opens Sports Topic, keyless; community DB completeness varies, engagement fields null on free |
| **data.gov.in (OGD)** ✓ | A | STORY | India | Free key (may need IN phone); many static datasets → curate live ones |
| **Reserve Bank of India** ✓ | A | STORY | India | Keyless, works; scope to rate decisions / auction results |
| **Stats SA (South Africa)** ✓ | A | STORY | Africa | data.gov.za CKAN is DNS-dead; only WP-REST live → fragile path |
| **GCC-Stat** ✓ | A | SIGNAL | MiddleEast | Only live Gulf anchor (UAE+Saudi blocked); SDMX-XML only, annual cadence |
| **Stats NZ** ✓ | A | SIGNAL | Oceania | New post-2024 API, stability unproven; SDMX-ML; free key |
| **Reserve Bank of Australia** ✓ | A | SIGNAL | Oceania | AUD rates fine; RBNZ half is 403 geo-blocked; CSV w/ 3rd-party-licensed columns |

---

## 3. PARK (8) — do not build now

| Source | Probe | Reason |
|---|---|---|
| **Reddit** | docs | ToS prohibits AI/ML use + bulk caching without commercial license — legally marginal |
| **CBS Israel** | live | Catalog too thin (14 pkgs); reference snapshots, not a news stream → enrichment lookup later |
| **football-data.org** | live | Orthogonal to geopolitics/markets focus; TheSportsDB covers Sports keyless |
| **China NBS** | **FAILED** | WAF blocks non-CN IPs (403 UrlACL); reverse-engineered endpoint renamed 3× in 2026 → use WB slice |
| **AfDB Data API** | **FAILED** | Cloudflare managed-challenge on every request; legacy 2013 mirror → use WB Africa slice |
| **UAE Bayanat** | **FAILED** | Cloudflare geo-blocks non-UAE IPs; GCC-Stat covers Gulf macro |
| **Saudi data.gov.sa** | **FAILED** | TCP timeout from non-KSA IPs; GCC-Stat covers Gulf macro |
| **data.gov.au** | live | Catalogue is scientific/geospatial, near-zero news-event density for our use |

---

## 4. ⚠ Legal / ToS gate — decide before adoption (Principle 4 caches everything)

| Source | Constraint | Mitigation |
|---|---|---|
| **Google Trends** | No official API; ToS forbids caching beyond no-store headers | Don't store; or drop. Recommend **PARK until official API** despite TRIAL verdict |
| **Reddit** | Prohibits AI/ML + bulk caching w/o commercial license | PARK |
| **ACLED** | Commercial aggregator product = paid corporate license; free tier 12-mo lag | Budget license or PARK |
| **Bank of Israel** | Blanket no-redistribution without written BOI consent | Use as internal scoring signal only, don't surface raw; or request consent |
| **CEPALSTAT** | ToS restricts redistribution/commercial | Legal review; likely OK as derived signal |
| **The Guardian** | Body-text bulk storage is a ToS grey zone | Store metadata + headline + link, fetch body on demand only |
| **NYT** | Restricts bulk caching/AI w/o paid data license | Metadata/ranking only |
| **Stack Exchange** | CC BY-SA 4.0 share-alike on all content | Attribution + share-alike review |
| **CoinGecko** | Attribution required ("Data provided by CoinGecko") | Add attribution in UI |

---

## 5. Region coverage achieved (per-bloc proposal)

Every target bloc now has at least one **confirmed objective anchor** — the fallback rule means no
bloc is left uncovered even where the national portal failed.

| Region | Primary anchor (confirmed) | Story feed | Notes |
|---|---|---|---|
| **Israel** | Bank of Israel, Knesset Votes | data.gov.il, Knesset | strongest non-World bloc |
| **US** | FRED (key) | NYT (key) | both DOCS-ONLY pending key |
| **China** | **World Bank slice** | – | NBS geo-blocked → fallback only |
| **India** | RBI | data.gov.in | both live |
| **EU** | Eurostat, ECB | European Parliament | strongest bloc; 3 Tier-A |
| **MiddleEast** | GCC-Stat (+ WB MENA fallback) | ReliefWeb | UAE+Saudi blocked → GCC-Stat anchor |
| **Africa** | World Bank Africa (+ Stats SA) | ReliefWeb, Stats SA | AfDB blocked → WB fallback |
| **LatinAmerica** | CEPALSTAT | Brazil IBGE | both live Tier-A |
| **Oceania** | Stats NZ, RBA | data.gov.au (parked) | RBNZ half geo-blocked |
| **World** | World Bank, GDELT, Frankfurter | USGS, GDACS, ReliefWeb, Guardian | event + macro + attention layers |

---

## 6. Recommended build sequence (for the wave-2 ADR / roadmap #9-#10)

1. **Signals foundation (Phase 4 #9):** World Bank (+ China slice), ECB, Eurostat, Frankfurter,
   USGS, GDACS, Wikipedia Pageviews — all keyless, no ToS blockers, establish the Story-vs-Signal split.
2. **Region story feeds:** European Parliament, Brazil IBGE, Knesset Votes, ReliefWeb (start appname approval now — slow), data.gov.il (scoped).
3. **Science depth:** OpenAlex + CrossRef (signals), pairing with existing arXiv.
4. **Sports Topic:** TheSportsDB (keyless pilot).
5. **Behind legal review:** Guardian (metadata-only), CoinGecko (attribution), CEPALSTAT, Stack Exchange.
6. **Keyed pilots:** FRED, NYT, data.gov.in, Stats NZ — once keys provisioned.
7. **Park / revisit:** Google Trends (until official API), Reddit, ACLED (until license budget),
   national portals behind geo-blocks (China NBS, AfDB, UAE, Saudi).

**Schema implication (ADR):** extend `SourceId` (+~25 slugs) and `Region` to the 10-bloc per-bloc set;
introduce the **Story vs. Signal** distinction so numeric feeds plug into `Signals`/scoring (ADR-0008)
rather than the story list. Coordinate the `types.ts` edit with the other active instance.
