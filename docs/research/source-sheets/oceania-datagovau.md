# data.gov.au — Australian Government Open Data  (SourceId: oceania-datagovau)

- **Tier:** A — primary-official government open-data portal (Australian federal + state agencies)
- **Role:** STORY (emits RawItem dataset catalogue records — title, notes/abstract, organisation, tags, temporal coverage, last-modified)
- **Endpoint probed:** GET `https://data.gov.au/data/api/3/action/package_search?rows=3&sort=metadata_modified+desc`
- **Format:** CKAN JSON (standard CKAN action API v3)
- **Auth:** none   |   **Rate limit:** not published in response headers; CloudFront-fronted, no `x-ratelimit-*` headers observed. Pacing: 1 req/s conservative; `rows` max likely 1000 per CKAN default.
- **Probe status:** LIVE-CONFIRMED (HTTP 200, parsed real JSON, 135 879 dataset records live as of 2026-06-17)
- **Region mapping:** asserts Oceania (Australian government datasets, spatial coverage field confirms "Australia") | proposed per-bloc Region: **Oceania**
- **Topic mapping:** native tags/groups must-infer → Science (environment, marine, geospatial), Business (economic data), Politics (government policy, native title, legislation), Other. No built-in topic taxonomy; must map from `tags[].name` + `organization.title` fields.
- **Signals yielded:**
  - points? NO — no popularity/vote/download-count field in package records
  - mentions? NO — no comment count
  - tone? NO — no sentiment field
  - `promotion_level` (integer 0–10) is present but appears editorial/admin only; `duplicate_score` (float) is an internal dedup aid. Neither substitutes for engagement signals.
- **externalId (dedup key):** `result.results[].id` — stable CKAN UUID e.g. `42ec7ebc-8b1e-4340-b46f-3bb24f74e36a`
- **Sample response shape:**
  ```json
  {
    "success": true,
    "result": {
      "count": 135879,
      "results": [{
        "id": "42ec7ebc-8b1e-4340-b46f-3bb24f74e36a",
        "name": "imos-ships-of-opportunity-...",
        "title": "IMOS Ships of Opportunity Underway Data ...",
        "notes": "Ships of Opportunity (SOOP) is a facility of the Australian Integrated Marine Observing System...",
        "metadata_created": "2026-06-05T06:52:08.886080",
        "metadata_modified": "2026-06-17T11:58:14.864840",
        "organization": { "title": "Australian Ocean Data Network", "name": "australian-ocean-data-network" },
        "license_id": "cc-by-4.0",
        "num_resources": 9,
        "tags": [],
        "promotion_level": "0",
        "duplicate_score": 1
      }]
    }
  }
  ```
- **Storage/ToS note:** Content is licensed CC BY 3.0 AU (platform) / CC BY 4.0 (many datasets). Attribution required: "Organisation name, jurisdiction, title of dataset, date sourced, dataset URL". Caching/storage of metadata records is permitted under CC BY. Individual dataset files may carry separate licences (`license_id` per record must be checked). No API key or registration required for read access.
- **Verdict:** PARK — the new axis is **Oceania regional official-government dataset catalogue**, filling the only blank Oceanic primary-official slot; however the source emits *dataset catalogue entries* (scientific/geospatial/administrative), not news-like story items. There are no engagement signals (no points, mentions, or tone fields), the content skews heavily toward environmental/scientific datasets rather than news-intelligence events, and topic mapping from free-form tags would require significant NLP overhead with low signal density for a news aggregator.
- **Risks:**
  - API path changed once already (was `/api/3/`, now `/data/api/3/`); CloudFront layer may add instability.
  - No documented rate limit — aggressive polling could trigger CloudFront throttling without warning.
  - Individual dataset licences vary; `license_id: notspecified` appears on a substantial fraction of harvested records (especially from ocean/scientific harvesters), requiring per-record licence checking before storage.
  - Content is predominantly scientific/geospatial (marine observation, land registry, statistics) — very few records correspond to news-intelligence events; poor topic-to-signal density for Project Horizon's use case.
  - Geo-restriction: none observed, but the Drupal 11 / CloudFront stack has geo-based edge caching that may behave differently from non-AU IPs.
