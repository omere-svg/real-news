# World Bank Open Data — China slice  (SourceId: china-worldbank)

- **Tier:** A — primary-official; data published directly by the World Bank, an intergovernmental institution; country=CHN filter is a first-class API parameter, not a scrape
- **Role:** SIGNAL (numeric scoring context; emits time-series macro indicators for China, not narrative content records)
- **Endpoint probed:** GET `https://api.worldbank.org/v2/country/CHN/indicator/NY.GDP.MKTP.CD?format=json&mrv=3&per_page=3`
- **Format:** JSON (also supports XML; `format=json` query param selects JSON)
- **Auth:** none   |   **Rate limit:** not published; Cloudflare CDN in front; `cache-control: public, max-age=2592001` (~30 days); URL caps: max 60 indicators per call, max 1,500 chars between slashes, max 4,000 chars total URL
- **Probe status:** LIVE-CONFIRMED (HTTP 200 + full JSON sample; keyless)
- **Region mapping:** asserts China — `countryiso3code: "CHN"` is baked into every record; this sheet intentionally scopes the adapter to the China bloc
- **Topic mapping:** macro economic/demographic indicators -> Business / Science (GDP, trade, inflation, energy, population, health); no native "topic" field — must-infer from `indicator.id` series used
- **Signals yielded:** points? NO  |  mentions? NO  |  tone? NO  — yields `value` (float/null), `date` (year string), `obs_status` (observation quality flag). Pure numeric signal; zero engagement metadata.
  - Signal JSON paths: `[1][n].value`, `[1][n].date`, `[1][n].indicator.id`, `[1][n].countryiso3code`
- **externalId (dedup key):** composite `{countryiso3code}:{indicator.id}:{date}` — e.g. `CHN:NY.GDP.MKTP.CD:2024`
- **Sample response shape:**
  ```json
  [
    { "page":1, "pages":1, "per_page":3, "total":3,
      "sourceid":"2", "lastupdated":"2026-04-08" },
    [
      { "indicator": { "id":"NY.GDP.MKTP.CD", "value":"GDP (current US$)" },
        "country":  { "id":"CN", "value":"China" },
        "countryiso3code": "CHN",
        "date": "2024",
        "value": 18743803170827.2,
        "unit": "", "obs_status": "", "decimal": 0 },
      { "indicator": { "id":"NY.GDP.MKTP.CD", "value":"GDP (current US$)" },
        "country":  { "id":"CN", "value":"China" },
        "countryiso3code": "CHN",
        "date": "2023",
        "value": 18270356654533.2,
        "unit": "", "obs_status": "", "decimal": 0 }
    ]
  ]
  ```
- **Storage/ToS note:** CC-BY 4.0 — caching and redistribution permitted with attribution ("World Bank Open Data, [indicator name], [URL]"). v2 indicator API is unrestricted CC-BY; microdata (separate product) requires written consent and is not covered here.
- **Verdict:** ADOPT — adds the **neutral official macro-economic anchor for the China bloc** (GDP, trade balance, inflation, energy, population growth) that no existing source (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) provides; the only Tier-A, zero-auth, cacheable signal source for China that is institutionally neutral and not subject to Chinese government editorial control.
- **Risks:** data latency (annual/quarterly releases; most-recent year value is often null until official WB release, typically 6–12 months lag); no published SLA or rate limit (rely on Cloudflare 30-day cache TTL); indicator series IDs can be deprecated or renamed across WB database versions; `sourceid` field meaning can shift if WB merges data catalogs; this sheet is a China-scoped filter on the general worldbank adapter — coordinate with worldbank.md to avoid duplicate ingestion of CHN records.
