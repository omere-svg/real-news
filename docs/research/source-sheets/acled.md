# ACLED (Armed Conflict Location & Event Data)  (SourceId: acled)

- **Tier:** B  +  neutral-aggregator (independent conflict-data NGO, sourced from public reports/media, not a primary government feed)
- **Role:** STORY (emits RawItem content — each event record is a discrete, datestamped, geolocated news-grade event)
- **Endpoint probed:** GET `https://acleddata.com/api/acled/read?_format=json&limit=1`
- **Format:** JSON (also CSV, XML)
- **Auth:** free-key (OAuth 2.0 Bearer token via `https://acleddata.com/oauth/token`; requires myACLED account registration — free for non-commercial/academic use)   |   **Rate limit:** 5,000 rows per request (default); pagination via `&page=X&limit=X`; no explicit per-minute cap documented, but pagination is excluded from rate-limit counting
- **Probe status:** DOCS-ONLY — endpoint is live (HTTP 403 `{"message":"Access denied"}` confirmed without auth); OAuth credentials required, none available; full field list sourced from docs
- **Region mapping:** asserts World (covers 200+ countries globally; no single-region restriction) | must-infer per-story region from `country` / `region` fields
- **Topic mapping:** native `event_type` (Battles / Explosions or Remote violence / Protests / Riots / Strategic developments / Violence against civilians) -> Geopolitics | must-infer
- **Signals yielded:** points? NO   mentions? NO   tone? PARTIAL — `fatalities` (integer death count) serves as a severity proxy; no native upvote/engagement counts; no sentiment field. JSON path: `.data[].fatalities`
- **externalId (dedup key):** `event_id_cnty` — e.g. `"SYR12345"` (country ISO prefix + sequential integer; stable after publication; a `timestamp` Unix field tracks last edits)
- **Sample response shape** (from docs — not live-confirmed):
  ```json
  {
    "event_id_cnty": "SYR12345",
    "event_date": "2024-10-15",
    "event_type": "Battles",
    "sub_event_type": "Armed clash",
    "actor1": "Syrian National Army",
    "actor2": "Syrian Democratic Forces",
    "country": "Syria",
    "admin1": "Aleppo",
    "latitude": "36.2021",
    "longitude": "37.1343",
    "fatalities": 12,
    "notes": "Forces clashed near the town of ...",
    "source": "Reuters",
    "timestamp": 1729036800
  }
  ```
- **Storage/ToS note:** CRITICAL — EULA prohibits commercial use without a corporate license. Storing data in a product that is a "functional substitute" for ACLED or that "competes with" ACLED is explicitly banned. Non-commercial/research accounts may cache during active use but must delete upon termination. Attribution is mandatory. AI/ML training use is prohibited. An intelligence aggregator serving commercial clients almost certainly requires a Partner or Enterprise license. **Strongly recommend legal review before integrating.**
- **Verdict:** TRIAL — adds **structured geolocated conflict-event data with fatality counts**, a severity-weighted ground-truth axis that none of HN/arXiv/GDELT/Knesset/SEC/Wikipedia provide at per-incident resolution. TRIAL rather than ADOPT because commercial licensing must be resolved first; if Project Horizon is non-commercial/research, proceed to ADOPT.
- **Risks:** (1) **Licensing** — commercial use requires paid corporate license; building a news aggregator product on ACLED data without one violates their EULA. (2) **Auth migration** — legacy API keys deprecated Sep 2025; OAuth-only going forward, adding token-refresh complexity. (3) **Data delay** — free/research tier may carry a 12-month lag; real-time data requires paid tier. (4) **Rate caps** — 5,000-row page limit; large-volume backfills require pagination and rate-conscious scheduling. (5) **Competitive-use clause** — any product that substitutes for ACLED's own dashboard is contractually prohibited.
