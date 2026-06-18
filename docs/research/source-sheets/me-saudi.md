# Saudi Arabia — Open Data Portal  (SourceId: me-saudi)

- **Tier:** A  +  primary-official government open-data portal operated by SDAIA (Saudi Data and Artificial Intelligence Authority), the national data regulator of Saudi Arabia
- **Role:** STORY (emits RawItem content — dataset metadata records describing government datasets)
- **Endpoint probed:** GET https://open.data.gov.sa/api/3/action/package_search?rows=3  (CKAN v3 action API)
- **Format:** CKAN JSON (standard CKAN API envelope: `{"success": true, "result": {"count": N, "results": [...]}}`)
- **Auth:** none (public portal; registration optional for commenting/ratings only) | **Rate limit:** not publicly documented; no API key scheme found in docs
- **Probe status:** FAILED — all IPs under 78.93.109.x (open.data.gov.sa) time out from outside Saudi Arabia; portal appears geo-restricted or blocks non-KSA egress. Attempted endpoints: open.data.gov.sa:443, data.gov.sa:443, od.data.gov.sa:443 — all connection timeout after 25 s. DNS resolves successfully (78.93.109.61 / 78.93.109.93) confirming the domain exists but the TCP handshake never completes from non-KSA addresses.
- **Region mapping:** asserts MiddleEast | Saudi Arabia government datasets; proposed per-bloc Region: MiddleEast
- **Topic mapping:** native categories span health, economy, education, environment, labor, public administration -> maps to Politics/Business/Science/Other; Geopolitics via energy/OPEC data; no Sports or AI-specific category identified
- **Signals yielded:** points? NO  mentions? NO  tone? NO  — CKAN dataset metadata records carry download counts (`num_resources`, `num_tags`) but no engagement points, comment counts, or sentiment fields; dataset `download_total` may be present but not a per-item signal comparable to HN score
- **externalId (dedup key):** CKAN `id` field (UUID) + `name` slug — e.g., `"id": "3b4f9a12-…"` / `"name": "population-by-region-2024"` (from CKAN schema docs; not live-confirmed due to geo-block)
- **Sample response shape (from CKAN standard schema, not live-confirmed):**
  ```json
  {
    "success": true,
    "result": {
      "count": 11439,
      "results": [
        {
          "id": "3b4f9a12-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          "name": "population-by-region-2024",
          "title": "Population by Region 2024",
          "organization": {"name": "general-authority-statistics"},
          "metadata_created": "2024-03-15T09:12:00.000Z",
          "metadata_modified": "2024-11-01T14:22:00.000Z",
          "resources": [{"format": "CSV", "url": "..."}],
          "tags": [{"name": "population"}, {"name": "demographics"}]
        }
      ]
    }
  }
  ```
- **Storage/ToS note:** Datasets are licensed under Creative Commons Attribution 3.0 International (CC-BY 3.0). Users must not distort/misrepresent data or source. Must not use for political purposes, unlawful activity, or anything illegal under KSA law. Caching of metadata should be permissible under CC-BY 3.0 with attribution to SDAIA/open.data.gov.sa.
- **Verdict:** PARK — the new axis it would add is KSA official government statistics (health, demographics, energy, economy from a top-10 OPEC producer) bridging the MiddleEast gap absent in HN/arXiv/GDELT/Knesset/SEC/Wikipedia; however the geo-restriction makes the API unreachable from standard cloud infrastructure outside Saudi Arabia, making reliable ingestion impossible without a KSA-based proxy or VPN, which conflicts with the project's zero-scraping / direct-API mandate.
- **Risks:**
  1. **Geo-restriction (critical):** TCP connections time out from non-KSA IPs; all three known subdomains blocked. Would require KSA-hosted infrastructure or a CDN relay — significant ops complexity.
  2. **API stability:** Portal underwent full redesign in 2023; the previous domain (data.gov.sa) was replaced by open.data.gov.sa; another migration is possible.
  3. **Rate limits undocumented:** No public SLA or rate-limit numbers found; could throttle heavily on bulk dataset-list calls.
  4. **Language:** Primary content is Arabic; English is secondary. Title/description fields may be Arabic-only for many datasets, requiring translation in the ETL pipeline.
  5. **KSA-law content restriction:** ToS explicitly forbids "political purposes" and anything illegal under KSA law — could conflict with balanced geopolitics coverage mandate if datasets touch sensitive regional topics.
  6. **No engagement signals:** Pure metadata catalogue; adds zero points/mentions/tone signal value for the scoring layer.
