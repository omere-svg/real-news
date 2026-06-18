# ReliefWeb (UN OCHA)  (SourceId: reliefweb)

- **Tier:** A  —  primary-official; operated by UN OCHA, the UN's humanitarian coordination body; content sourced from governments, UN agencies, and accredited NGOs
- **Role:** STORY (emits RawItem content records: humanitarian situation reports, flash updates, press releases, assessments)
- **Endpoint probed:** GET https://api.reliefweb.int/v2/reports?appname=real-news-probe&limit=2
- **Format:** JSON
- **Auth:** free-key (pre-approved `appname` parameter required since 2025-11-01; no API key secret, but appname must be registered via form and approved by ReliefWeb before use)  |  **Rate limit:** 1,000 calls/day, 1,000 records/call; increases reviewable on request
- **Probe status:** DOCS-ONLY — endpoint is live (HTTP 403 received with body confirming the API is operational and v2 is current), but requires an approved `appname` which we do not yet hold. v1 was decommissioned; v2 requires registration.
- **Region mapping:** asserts Africa / MiddleEast (country and primary_country fields are structured arrays with ISO codes; regions can be inferred or filtered directly; strong Africa/MENA coverage by publication volume)
- **Topic mapping:** `theme` array (ReliefWeb taxonomy: "Humanitarian Financing", "Food and Nutrition", "Health", "Natural Disasters", "Conflict and Violence", etc.) -> Geopolitics / Other | must-infer for Politics/Business sub-splits
- **Signals yielded:** points? NO  |  mentions? NO  |  tone? NO — no engagement or sentiment fields exist in the v2 schema; all fields are metadata and content only
- **externalId (dedup key):** `data[].id` — integer, e.g. `1234567`; stable unique report ID assigned by ReliefWeb; `data[].fields.url_alias` provides a human-readable stable slug as secondary key
- **Sample response shape** (from docs / field-table; real 2xx body not available without approved appname):
  ```json
  {
    "data": [{
      "id": 1234567,
      "fields": {
        "title": "Sudan: Humanitarian Situation Report #12",
        "date": { "created": "2025-06-15T08:00:00+00:00", "original": "2025-06-14" },
        "source": [{ "name": "OCHA", "shortname": "OCHA" }],
        "country": [{ "name": "Sudan", "iso3": "SDN" }],
        "theme": [{ "name": "Conflict and Violence" }],
        "url": "https://reliefweb.int/report/sudan/...",
        "status": "published"
      }
    }],
    "totalCount": 94821
  }
  ```
- **Storage/ToS note:** CC BY 4.0 — caching and storage is permitted; attribution to original source required ("respect intellectual property rights of original source"); ReliefWeb disclaims accuracy liability; no fees.
- **Verdict:** ADOPT — adds structured UN-official humanitarian crisis feed; the only proposed source covering active armed conflicts, disaster declarations, and refugee crises with country-level metadata; fills the Africa/MENA geopolitical gap absent from HN/arXiv/GDELT/Knesset/SEC/Wikipedia
- **Risks:** (1) appname approval introduces onboarding friction (days to weeks lead time); (2) 1,000 calls/day cap is tight if polling multiple content types at high frequency — single-endpoint daily crawl is feasible, but disaster + reports + updates combined may saturate limit; (3) content is humanitarian-agency POV — not all geopolitical topics covered, and source mix (UN + NGOs) introduces institutional framing; (4) no native engagement signals means it contributes zero to scoring pipeline and is STORY-only; (5) API v1 was silently decommissioned — v2 stability not formally guaranteed, though OCHA dependency is strong.
