# African Development Bank Data Portal API  (SourceId: africa-afdb)

- **Tier:** A — primary-official (official AfDB multilateral bank statistics, continental macro indicators)
- **Role:** SIGNAL (numeric scoring context — economic indicators, GDP, trade, demographics; no story/article content emitted)
- **Endpoint probed:** GET https://dataportal.opendataforafrica.org/api/1.0/sdmx/v2.1/dataflow/AfDB
- **Format:** SDMX 2.1 XML / SDMX-JSON (Content-type negotiated via Accept header)
- **Auth:** free-key (free registration at dataportal.opendataforafrica.org yields App ID + App Secret; anonymous access limited to 50 requests per Knoema platform policy; authenticated allows 500 requests)   |   **Rate limit:** 50 req/session unauthenticated; ~500/day with free key (Knoema platform standard; opendataforafrica.org enforces same policy)
- **Probe status:** FAILED — Cloudflare WAF (cf-mitigated: challenge) returns HTTP 403 Managed Challenge on all automated requests regardless of User-Agent or Accept headers; the API infrastructure exists and is documented but programmatic access is blocked at the CDN layer without a browser-solved Cloudflare Turnstile token. The SDMX 2.1 REST API is confirmed to exist at the documented base path but cannot be accessed without prior browser session.
- **Region mapping:** asserts Africa | proposed per-bloc Region: Africa (54-country continental coverage, AfDB member states)
- **Topic mapping:** economic/macro statistics -> Business (GDP, trade, investment); demographics/social -> Other; governance -> Geopolitics/Politics | must-infer (no native topic taxonomy in SDMX; indicators mapped by code convention)
- **Signals yielded:** points? NO   mentions? NO   tone? NO  — Pure statistical time-series observations with no engagement, sentiment, or popularity signals. Fields: `.value` (numeric observation), `.obs_status` (observation status flag), `.date` (period), `.country.id` / `.country.value`, `.indicator.id` / `.indicator.value`. No signals for scoring pipeline.
- **externalId (dedup key):** SDMX key pattern `{agencyId}/{resourceId}/{version}/{dimensionKey}` e.g. `AfDB/AfricaInfo/1.0/A.GDP_CURRUSD.NG` (frequency.indicator.countryISO); within SDMX-JSON response the key is composed from the `series` object keys in `dataSets[0].series`
- **Sample response shape** (from docs; not live-confirmed due to Cloudflare block):
  ```json
  {
    "header": { "id": "...", "prepared": "2024-01-15T10:00:00Z", "sender": { "id": "AfDB" } },
    "dataSets": [{ "action": "Information", "series": {
      "0:0:0": { "attributes": [0, 0], "observations": {
        "0": [1934399104910.02, 0, null]
      }}
    }}],
    "structure": { "dimensions": { "series": [
      { "id": "FREQ", "name": "Frequency", "values": [{"id":"A","name":"Annual"}] },
      { "id": "INDICATOR", "name": "Indicator", "values": [{"id":"GDP_CURRUSD","name":"GDP (current USD)"}] },
      { "id": "REF_AREA", "name": "Reference area", "values": [{"id":"NG","name":"Nigeria"}] }
    ]}}
  }
  ```
- **Storage/ToS note:** AfDB/Open Data for Africa portal publishes data under Creative Commons Attribution (CC-BY) license for public datasets. Attribution to "African Development Bank, Open Data for Africa" required. Caching of indicator values permissible; redistribution requires attribution. ToS page (https://dataportal.opendataforafrica.org/terms) returns 403 from automated agents — full terms not confirmed programmatically.
- **Verdict:** PARK — Cloudflare WAF makes programmatic ingestion non-viable without a maintained browser-cookie session; free API key alone is insufficient to bypass CDN challenge. Additionally, the source yields zero engagement signals and would only add continental macro SIGNAL context (GDP, trade balance, population) for the Africa region — a niche already partially covered by World Bank WDI (source=2, live and key-free) at broader scope. The NEW axis it would add vs HN/arXiv/GDELT/Knesset/SEC/Wikipedia: **official AfDB continental macro-economic series** as Africa-regional SIGNAL baseline for story contextualization (e.g. GDP per country for normalizing GDELT event volume), but this can be substituted with World Bank WDI which is accessible without friction.
- **Risks:**
  1. **CDN/WAF contract stability**: Cloudflare Managed Challenge blocks all automated access; no documented API IP allowlist or programmatic bypass path — integration requires Cloudflare Turnstile solve or registered IP exemption negotiated with AfDB/Knoema.
  2. **Rate caps**: 50 requests unauthenticated is very low; free tier (500/day) may be insufficient for bulk indicator polling across 54 countries × 1,745 indicators.
  3. **Platform dependency**: Portal runs on Knoema's iResearch platform — if Knoema changes pricing or AfDB migrates platform, all endpoints change.
  4. **SDMX complexity**: SDMX 2.1 XML/JSON requires custom parser; no simple REST-JSON response; dimensional key mapping requires loading the data structure definition (DSD) first, doubling request count.
  5. **Legacy data risk**: World Bank mirror of AfDB data (source=11, Africa Development Indicators) was last updated 2013-02-22 — shows AfDB has historically discontinuous data pipelines.
  6. **Geo-restriction**: No documented geo-restriction but Cloudflare may rate-limit or block datacenter/cloud egress IPs (common for Knoema-hosted portals).
