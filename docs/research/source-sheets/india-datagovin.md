# data.gov.in (OGD Platform India)  (SourceId: india-datagovin)

- **Tier:** A — primary-official government open-data catalogue published directly by Indian ministries and central/state agencies under the National Data Sharing and Accessibility Policy (NDSAP)
- **Role:** STORY (emits RawItem content records: dataset metadata with title, org, sector, timestamps)
- **Endpoint probed:** GET https://api.data.gov.in/lists?format=json&limit=5&offset=1000
- **Format:** JSON (custom REST, CKAN-like; Elasticsearch backing revealed in `params` field)
- **Auth:** free-key required for `/resource/{id}` (row-level data); `/lists` catalog index is open (no key)   |   **Rate limit:** not publicly documented; X-Generator: tyk.io gateway observed — typical OGD India quota is 1,000 req/day per key (unconfirmed)
- **Probe status:** LIVE-CONFIRMED — `/lists` returned HTTP 200 + parsed JSON with `total: 285441` active datasets; `/resource/{id}` returns `{"error": "Key not authorised"}` — free-key registration required at data.gov.in portal
- **Region mapping:** asserts India | per-bloc Region: **India**
- **Topic mapping:** native `sector` array (e.g. "Road Transport", "Census and Surveys", "Agriculture") → our Topics: Politics / Business / Science / Other — must-infer per sector value at ingest time
- **Signals yielded:** points? NO. mentions? NO. tone? NO. No download counts, view counts, stars, or sentiment fields appear in the `/lists` response schema. Fields are purely metadata (`created`, `updated`, `active`, `visualizable`).
- **externalId (dedup key):** `index_name` (UUID slug, e.g. `"caf862a9-bfae-4640-b755-39096be7f930"`)
- **Sample response shape:**
  ```json
  {
    "index_name": "caf862a9-bfae-4640-b755-39096be7f930",
    "title": "Sales of Motor Vehicles in India for 1960-89",
    "org_type": "Central",
    "org": ["Ministry of Road Transport and Highways"],
    "sector": ["Road Transport"],
    "source": "data.gov.in",
    "catalog_uuid": "0c6eb054-0d2c-41d8-865d-37e21ca0942c",
    "active": "1",
    "created_date": "2017-09-06T21:10:22Z",
    "updated_date": "2018-11-29T23:53:54Z"
  }
  ```
- **Storage/ToS note:** Data published under the **Government Open Data License – India (GODL-India)**, which permits free use, redistribution, and adaptation with attribution. Caching and storage are permitted; attribution to the originating ministry/department is required. See: https://data.gov.in/government-open-data-license-india
- **Verdict:** TRIAL — adds **India government primary-official datasets** (285k+ resources from central/state ministries), a geography not covered by any existing source. Closest in character to SEC EDGAR (official filings) but for Indian public data across all sectors.
- **Risks:** (1) `/resource/{id}` row data requires a free API key — registration may require an Indian government email or phone verification; (2) Rate limits are undocumented and enforced by Tyk gateway; (3) Catalog index (`/lists`) has no time-window filter — full incremental polling requires tracking `updated` timestamps client-side; (4) Many datasets are static historical uploads (last updated 2018) rather than live feeds; (5) Data quality and recency vary widely by ministry; (6) No engagement/signal fields — cannot rank by popularity.
