# CBS Israel – Central Bureau of Statistics  (SourceId: cbs-israel)

- **Tier:** A — primary-official national statistics authority (Israel's sole official statistical body)
- **Role:** SIGNAL (numeric reference/enrichment data — demographic, geographic, and economic statistics used to score or contextualize STORY records; not a stream of news items)
- **Endpoint probed:** `GET https://data.gov.il/api/3/action/datastore_search?resource_id=5474c592-3faa-4298-8783-a8da9acc040f&limit=3`
- **Format:** CKAN JSON (standard CKAN DataStore API v3; underlying raw files are CSV/XLSX)
- **Auth:** none  |  **Rate limit:** no published rate cap; response headers show `Cache-Control: public, max-age=3600, s-maxage=14400` — suggest gentle pacing (e.g. 1 req/s)
- **Probe status:** LIVE-CONFIRMED — received HTTP 200 + parsed sample; `"success": true`, 87 total records returned
- **Region mapping:** asserts Israel | proposed per-bloc Region: **Israel**
- **Topic mapping:** Demographics → Science/Other; Road accidents → Other; Population census → Other; Localities → Other. No AI/Geopolitics/Politics/Sports/Business content — must-infer for topic enrichment use-cases
- **Signals yielded:** points? NO. mentions? NO. tone? NO.  
  — CBS data is purely quantitative reference tables (population counts, age brackets, ethnic breakdowns, locality codes). No engagement or sentiment signals are exposed.
- **externalId (dedup key):** `result.id` at package level (e.g. `3bd97fde-6cc3-456d-ab63-1caad16b2b6a`); at row level: `_id` integer auto-key within each datastore resource (e.g. `_id: 1`). Stable compound key: `<resource_id>:<_id>` (e.g. `5474c592-3faa-4298-8783-a8da9acc040f:1`)
- **Sample response shape:**
  ```json
  {
    "success": true,
    "result": {
      "total": 87,
      "fields": ["_id","Age","Total_Population","Jews_and_Others","Arabs_Total","Foreigners",...],
      "records": [
        {"_id":1,"Age":"0","Total_Population":" 185,248 ","Jews_and_Others":" 140,845 ","Arabs_Total":" 42,869 ","Foreigners":" 1,534 "},
        {"_id":2,"Age":"1","Total_Population":" 179,415 ","Jews_and_Others":" 135,986 ","Arabs_Total":" 41,678 ","Foreigners":" 1,751 "}
      ]
    }
  }
  ```
- **Storage/ToS note:** License is `other-open` (`isopen: true`) on all CBS datasets published via data.gov.il. The portal operates under Israel's Government Data Openness policy (analogous to CC-BY or OGL). Attribution to the Central Bureau of Statistics (הלשכה המרכזית לסטטיסטיקה) is expected. No explicit prohibition on caching found; `Cache-Control: public` headers permit downstream caching.
- **Verdict:** PARK — The new axis CBS adds is **official Israel demographic and geographic reference data** (population by age, locality codes, census 2022). However the catalog is extremely small (14 packages, mostly road-accident PUFs and census snapshots), updated infrequently, and emits no story stream, no engagement signals, and no topic-tagged items that would flow into the aggregator's pipeline. It is more useful as a static enrichment lookup (e.g. locality-code → population size) than as an ingested source. PARK until a need for Israel-specific geographic or demographic enrichment arises.
- **Risks:**
  - **Catalog stability:** Only 14 packages from CBS on data.gov.il; this is very thin and CBS does not appear to maintain its own dedicated SDMX/REST API (no official CBS developer portal found). The portal may be the only machine-readable access point.
  - **Rate caps:** No published limits but the data is hosted on Israel's central government CKAN instance; heavy polling could trigger informal throttling.
  - **Freshness:** Most datasets reflect decennial census or annual surveys (not live feeds). The latest population census is from 2022; road accident PUFs lag 1–2 years.
  - **License ambiguity:** `other-open` is not a named license (not CC-BY or OGL); the exact reuse terms require checking Israel's Freedom of Information regulations and the government opendata portal ToS.
  - **Geo-restriction:** No geo-blocking observed; the API is publicly accessible globally without VPN.
  - **No signals:** This source yields no points, mentions, or tone fields — it cannot contribute to engagement scoring without significant data-model work to derive population-weighted locality scores from raw census tables.
