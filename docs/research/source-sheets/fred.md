# FRED (St. Louis Fed)  (SourceId: fred)

- **Tier:** A — primary-official; data published directly by the Federal Reserve Bank of St. Louis, a US government-chartered central bank institution
- **Role:** SIGNAL (numeric scoring context; emits high-frequency economic time-series — interest rates, CPI, GDP, unemployment, money supply — not narrative content records)
- **Endpoint probed:** GET `https://api.stlouisfed.org/fred/series/observations?series_id=GDP&file_type=json` (without registered `api_key`)
- **Format:** JSON (default is XML; `file_type=json` query param selects JSON; both formats supported)
- **Auth:** free-key (must register at https://fred.stlouisfed.org/docs/api/api_key.html for a free API key; no OAuth, just a static token passed as `api_key=` query param)   |   **Rate limit:** not published in official docs; community sources report ~120 requests/minute per key; pagination via `limit` (max 100,000 obs per call) and `offset`; max 1,000 series per search result page
- **Probe status:** DOCS-ONLY — curl without key returns `{"error_code":400,"error_message":"Bad Request. Variable api_key is not set."}`. curl with a random unregistered key returns `{"error_code":400,"error_message":"Bad Request. The value for variable api_key is not registered."}`. No registered key available, live call skipped.
- **Region mapping:** asserts US (core focus is US macro data — Fed Funds Rate, CPI, PCE, payrolls, M2); also carries >800,000 series from 107 sources including ECB, BIS, IMF, OECD, World Bank for international coverage — must-infer for non-US blocs
- **Topic mapping:** economic/financial indicators -> Business; also Science (climate, energy series from EIA/EPA) and Other (demographics); no native "topic" field — category hierarchy (`/fred/category`) provides a browse tree but requires separate call
- **Signals yielded:** points? YES (`popularity` field, integer 0–100, on series metadata responses) | mentions? NO | tone? NO
  - Popularity path: `$.seriess[n].popularity` (from `/fred/series` or `/fred/series/search` endpoints)
  - Observation value path: `$.observations[n].value` (string; "." for missing)
  - Observation date path: `$.observations[n].date` (ISO 8601 string, e.g. `"2025-01-01"`)
- **externalId (dedup key):** composite `{series_id}:{date}` — e.g. `GDP:2025-01-01`; series-level dedup: `series_id` string alone (e.g. `"GDP"`, `"FEDFUNDS"`, `"CPIAUCSL"`)
- **Sample response shape:**
  ```json
  // GET /fred/series/observations?series_id=FEDFUNDS&file_type=json&limit=3 (from docs)
  {
    "realtime_start": "2025-01-01",
    "realtime_end":   "2025-01-01",
    "observation_start": "1954-07-01",
    "observation_end":   "9999-12-31",
    "units": "lin",
    "output_type": 1,
    "file_type": "json",
    "order_by": "observation_date",
    "sort_order": "asc",
    "count": 855,
    "offset": 0,
    "limit": 3,
    "observations": [
      { "realtime_start":"2025-01-01","realtime_end":"2025-01-01",
        "date":"1954-07-01","value":"1.13" },
      { "realtime_start":"2025-01-01","realtime_end":"2025-01-01",
        "date":"1954-08-01","value":"1.22" },
      { "realtime_start":"2025-01-01","realtime_end":"2025-01-01",
        "date":"1954-09-01","value":"1.06" }
    ]
  }
  ```
- **Storage/ToS note:** FRED data is produced by a US federal institution (Federal Reserve Bank of St. Louis) and is explicitly in the public domain for US government-produced data; third-party series within FRED (e.g., from private providers) carry their own licenses — must verify per `source_id`. FRED ToS requires attribution ("Source: FRED, Federal Reserve Bank of St. Louis") and prohibits implying Fed endorsement. Caching is permitted; ALFRED (vintage history) data has same terms.
- **Verdict:** TRIAL — adds **high-frequency US monetary/macro signal axis** (Fed Funds Rate, CPI, unemployment, yield curve) that World Bank does not cover at monthly/weekly/daily granularity; closest analog is World Bank (already planned for ADOPT) but FRED is US-centric with faster release cadence, richer revision history (ALFRED), and a `popularity` score — however, a free key registration step is required and the data overlaps substantially with World Bank for non-US series, making it a trial until the key is in hand and overlap with worldbank is assessed.
- **Risks:** requires free-key registration (one extra ops step; keys can be revoked without notice); ~800,000 series makes series selection non-trivial without a catalogue build step; `popularity` field range (0–100) is opaque in methodology; third-party series embedded in FRED carry varying licenses requiring per-source audit; no published SLA or rate-limit documentation; US-centric — non-US blocs mostly covered by resurfaced World Bank / IMF series already available elsewhere.
