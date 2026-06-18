# World Bank Open Data  (SourceId: worldbank)

- **Tier:** A — primary-official; data published directly by the World Bank, an intergovernmental institution
- **Role:** SIGNAL (numeric scoring context; emits time-series macro indicators, not narrative content records)
- **Endpoint probed:** GET `https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=2`
- **Format:** JSON (also supports XML; `format=json` query param selects JSON)
- **Auth:** none   |   **Rate limit:** not published; Cloudflare CDN in front (`cf-cache-status: HIT`); `cache-control: public, max-age=2592001` (~30 days); URL length caps: max 60 indicators per call, max 1,500 chars between slashes, max 4,000 chars total URL
- **Probe status:** LIVE-CONFIRMED (HTTP 200 + parsed JSON sample; keyless)
- **Region mapping:** asserts World (global coverage: every ISO country/region; purpose-built neutral fallback for China, Africa, MENA, LatAm blocs)
- **Topic mapping:** macro economic/demographic indicators -> Business / Science (GDP, population, trade, inflation, health, energy); must-infer per indicator series used — no native "topic" field
- **Signals yielded:** points? NO  |  mentions? NO  |  tone? NO  — yields `value` (float/null), `date` (year), `obs_status` (observation quality flag). Pure numeric signal; no engagement metadata.
  - Signal JSON paths: `[1][n].value`, `[1][n].date`, `[1][n].indicator.id`, `[1][n].country.id`
- **externalId (dedup key):** composite `{countryiso3code}:{indicator.id}:{date}` — e.g. `USA:NY.GDP.MKTP.CD:2024`
- **Sample response shape:**
  ```json
  [
    { "page":1, "pages":33, "per_page":2, "total":66,
      "sourceid":"2", "lastupdated":"2026-04-08" },
    [
      { "indicator": { "id":"NY.GDP.MKTP.CD", "value":"GDP (current US$)" },
        "country":  { "id":"US", "value":"United States" },
        "countryiso3code": "USA",
        "date": "2024",
        "value": 28750956130731.2,
        "unit": "", "obs_status": "", "decimal": 0 }
    ]
  ]
  ```
- **Storage/ToS note:** CC-BY 4.0 — caching and redistribution permitted with attribution ("World Bank Open Data, [indicator name], [URL]"). Microdata (separate product) requires written consent; v2 indicator API is unrestricted CC-BY.
- **Verdict:** ADOPT — adds the **macro-economic numeric context axis** (GDP, population, trade balances, inflation, energy mix) that no existing source (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) provides; serves as the neutral-official regional anchor for China, Africa, MENA, and LatAm blocs where editorial sources are sparse.
- **Risks:** data latency (annual/quarterly releases; `date:"2025"` value was null at probe time, meaning most-recent year often unfilled); no SLA or published rate limit (rely on Cloudflare caching with 30-day TTL to self-limit); indicator series can be deprecated or renamed across WB database versions; `sourceid` field can shift meaning if WB merges data catalogs.
