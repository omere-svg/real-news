# GDELT per-region tone/volume slices  (SourceId: gdelt-slices)

- **Tier:** B — neutral-aggregator; GDELT measures coverage *about* world events rather than publishing primary facts; its tone and volume metrics are objective measurements derived from the global media corpus, not editorial opinions
- **Role:** SIGNAL (numeric scoring context — per-region coverage volume and average tone time series; does not emit narrative story records; the base `gdelt` source already handles ArtList story ingestion)
- **Endpoint probed:** GET `https://api.gdeltproject.org/api/v2/doc/doc?query=Israel&mode=TimelineVol&TIMESPAN=7DAYS&SOURCECOUNTRY=US&format=json`
- **Format:** JSON (UTF-8; also supports CSV, RSS, JSONFeed, JSONP; `format=json` selects structured output)
- **Auth:** none   |   **Rate limit:** 1 request per 5 seconds enforced server-side; violators receive HTTP 429 with message "Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries." No daily cap documented; pacing at ≥5 s between calls is mandatory.
- **Probe status:** LIVE-CONFIRMED (HTTP 200 + parsed JSON; TimelineVol call for query="Israel", SOURCECOUNTRY=US, TIMESPAN=7DAYS returned 145 hourly data points spanning 2026-06-10 to 2026-06-17; no key required)
- **Region mapping:** must-infer for the item topic, but the `SOURCECOUNTRY` query parameter accepts 2-character FIPS codes to slice coverage by media source country, enabling per-bloc signals: `IL` → Israel, `US` → US, `CN` → China, `IN` → India, `DE`/`FR`/`GB` → EU-bloc proxy; the `query` term itself can be a country or region name (e.g. `query=Gaza`, `query=EU`, `query=MiddleEast`) to further focus the slice
- **Topic mapping:** must-infer — the query string drives topical focus (e.g. `query=AI`, `query=diplomacy`); GDELT GKG `theme:` operator (e.g. `theme:TERROR`, `theme:ECON_TRADE`) maps to Geopolitics/Politics/Business/Other; no closed native taxonomy matching our Topic set
- **Signals yielded:** points? NO  |  mentions? YES (TimelineVolRaw `value` = raw article count, `norm` = total monitored articles, giving a coverage-volume `mentions`-equivalent)  |  tone? YES (TimelineTone `value` = average tone of all matching articles, scale −100 to +100, typical real-world range −20 to +20)
  - Volume signal JSON paths: `$.timeline[0].data[n].date`, `$.timeline[0].data[n].value` (TimelineVol = % of total monitored coverage; TimelineVolRaw adds `$.timeline[0].data[n].norm`)
  - Tone signal JSON paths: `$.timeline[0].data[n].date`, `$.timeline[0].data[n].value` (TimelineTone mode; same shape, different semantic meaning)
  - Query metadata: `$.query_details.query`, `$.query_details.date_resolution` (e.g. `"hour"`)
- **externalId (dedup key):** composite `{mode}:{query}:{SOURCECOUNTRY}:{date}` — e.g. `TimelineTone:Israel:US:20260615T000000Z`; no native document-level ID exists for timeline slices (they are aggregated metrics, not individual records)
- **Sample response shape:**
  ```json
  {
    "query_details": { "query": "Israel", "date_resolution": "hour" },
    "timeline": [
      {
        "series": "Volume Intensity",
        "data": [
          { "date": "20260610T120000Z", "value": 1.4449 },
          { "date": "20260611T000000Z", "value": 2.1873 },
          { "date": "20260615T000000Z", "value": 6.1213 }
        ]
      }
    ]
  }
  ```
- **Storage/ToS note:** GDELT is described as "100% free and open" by the project. No explicit cache/storage prohibition found in available docs; the project encourages re-use including BigQuery at scale. Attribution to "The GDELT Project" is expected by convention; the GDELT blog states data is openly reusable. The 5 s/request rate limit is the only hard constraint. Raw article text is NOT returned in timeline modes (only aggregated metrics), so no third-party copyright exposure in caching timeline JSON.
- **Verdict:** ADOPT — adds the **per-region media-attention tone axis**: for any topic × country-of-source slice (e.g. "how is AI being covered in Israeli media?" or "what is the tone of US coverage on the Gaza conflict right now?"), this provides a real-time, keyless, objective sentiment signal that none of HN/arXiv/Knesset/SEC/Wikipedia/base-GDELT-artlist exposes in isolation; uniquely enables cross-regional tone divergence detection (e.g. US tone vs. IL tone on the same query = a framing-gap signal).
- **Risks:** rate cap is tight (12 req/min max) — a multi-region × multi-topic polling loop must be carefully budgeted; TIMESPAN max is 3 months limiting historical backfill; the 5 s rule is undocumented in formal terms (communicated via 429 error body only), so it could tighten without notice; SOURCECOUNTRY uses 2-character FIPS codes (not ISO-3166-1 alpha-2), which differ for some countries (e.g. FIPS `GM` = Germany, ISO `DE` = Germany — must verify per country); the project is maintained by a single researcher (Kalev Leetaru) creating a single-point-of-failure risk; no SLA or uptime guarantee; the `series` label in the response ("Volume Intensity") is informal and could change silently across API versions.
