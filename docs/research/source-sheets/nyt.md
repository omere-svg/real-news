# NYT APIs (Top Stories / Most Popular)  (SourceId: nyt)

- **Tier:** D  +  editorial — content is curated/ranked by NYT editors and audience engagement; high editorial authority but reflects one outlet's perspective and US-centric coverage priorities
- **Role:** BOTH — Top Stories emits RawItem content records (title, abstract, url, section, published_date, byline) AND Most Popular supplies numeric engagement signals (views, total_shares as points proxies)
- **Endpoint probed:** GET https://api.nytimes.com/svc/mostpopular/v2/mostviewed/all-sections/1.json  (no api-key provided)
- **Format:** JSON
- **Auth:** free-key (API key required — obtained via free registration at developer.nytimes.com; passed as query param `?api-key=YOUR_KEY`)  |  **Rate limit:** 10 requests/second, 4,000 requests/day per key (per developer portal documentation; 403 with `"Developer Over Qps"` returned on breach)
- **Probe status:** DOCS-ONLY — live GET without key returned HTTP 401 with `{"fault":{"faultstring":"Failed to resolve API Key variable request.queryparam.api-key","detail":{"errorcode":"steps.oauth.v2.FailedToResolveAPIKey"}}}`. No key available in this environment; all fields documented from GitHub OpenAPI spec (github.com/NYTimes/public_api_specs).
- **Region mapping:** asserts US / World — Top Stories section field maps directly (`world` → World, `politics` → US, `technology` → World); geo_facet array enables finer region inference (e.g. `["Israel", "Gaza Strip"]` → MiddleEast); propose: use geo_facet for per-bloc region tagging, fall back to section name
- **Topic mapping:** section → our Topic: `technology` → AI/Science, `business` → Business, `sports` → Sports, `world` / `foreign` → Geopolitics, `politics` → Politics, `arts` / `style` → Other; geo_facet + des_facet allow finer NLP-free classification
- **Signals yielded:**
  - points (view popularity): `results[*].views` (integer) on `/mostviewed/` endpoint — e.g. `1` in placeholder, real values are rank positions 1–20
  - points (share count): `results[*].total_shares` (integer) on `/mostshared/` endpoint — e.g. `1`
  - mentions: no comment-count field available in any Most Popular endpoint
  - tone: no native sentiment field; `des_facet` tags (e.g. `"Terrorism"`, `"Elections"`) are a weak topic-tone proxy
- **externalId (dedup key):** `results[*].asset_id` — stable integer NYT asset identifier, e.g. `100000004214575`; present on both Most Popular endpoints. Top Stories has no `asset_id`; use `results[*].url` (canonical article URL) as fallback dedup key.
- **Sample response shape** (from OpenAPI spec at github.com/NYTimes/public_api_specs; not live-confirmed):
  ```json
  {
    "status": "OK",
    "copyright": "Copyright (c) 2025 The New York Times Company.",
    "num_results": 20,
    "results": [{
      "asset_id": 100000004229487,
      "url": "https://www.nytimes.com/2025/06/17/world/...",
      "title": "Example Headline",
      "abstract": "Brief description of the article.",
      "byline": "By Jane Smith",
      "section": "World",
      "published_date": "2025-06-17",
      "views": 1,
      "total_shares": 42,
      "geo_facet": ["Israel", "Gaza Strip"],
      "des_facet": ["Terrorism", "International Relations"],
      "media": [{"url": "...", "format": "Standard Thumbnail"}]
    }]
  }
  ```
- **Storage/ToS note:** NYT developer terms (developer.nytimes.com/terms) require: (1) attribution — "Data provided by The New York Times" with link; (2) no redistribution of raw article body text (abstracts and metadata permitted); (3) caching allowed for operational performance but not bulk archival or resale; (4) commercial use requires review — free tier intended for non-commercial/research applications. Storing `asset_id`, `url`, `title`, `abstract`, `section`, `published_date`, and engagement counts (views, total_shares) as metadata appears consistent with developer terms; storing full article body (not returned by these endpoints) would require a content licensing agreement. Attribution clause must be surfaced in any UI.
- **Verdict:** TRIAL — adds **mainstream US editorial engagement ranking** not present in HN/arXiv/GDELT/Knesset/SEC/Wikipedia; Most Popular view/share counts are the only direct mass-audience readership signal in the proposed source set, providing a "what America's largest newspaper readers are actually consuming" axis against which to score importance of events detected by other sources.
- **Risks:**
  - **Editorial bias:** NYT is a US-headquartered outlet with editorial perspective; Tier D reflects this — not a primary official or neutral aggregator source. Coverage of Israel/MiddleEast carries known editorial framing risks.
  - **Rate cap:** 4,000 req/day across all endpoints; with Top Stories (25 sections) + Most Popular (3 endpoints × 3 time periods) = up to 34 calls per polling cycle, budget is tight at high-frequency polling — must pace to ~1 poll/hour max.
  - **No article body:** these endpoints return title + abstract only; full text requires Article Search API (separate endpoint, same key) or a content license — limits NLP depth.
  - **externalId fragility:** Top Stories lacks `asset_id`; URL must serve as dedup key but NYT URLs can change (section restructuring, corrections); `short_url` (e.g. `nyti.ms/...`) is more stable but not always present.
  - **ToS instability:** NYT has tightened developer terms in recent years (deprecated several APIs); free tier continuation is not guaranteed; commercial/AI-intelligence use case may require a paid data license (NYT Licensing group).
  - **US-centrism:** section taxonomy and editorial priorities skew heavily toward US domestic news; World/Geopolitics section is broad but sparse on non-English-language regional events (Africa, LatinAmerica, Oceania coverage is thin).
