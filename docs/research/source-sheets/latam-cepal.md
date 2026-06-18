# UN ECLAC / CEPALSTAT  (SourceId: latam-cepal)

- **Tier:** A — primary-official; published directly by the UN Economic Commission for Latin America and the Caribbean (ECLAC), a principal UN body
- **Role:** SIGNAL (numeric macro-indicator time series — not narrative content records)
- **Endpoint probed:** `GET https://api-cepalstat.cepal.org/cepalstat/api/v1/indicator/3127/data?lang=en&format=json`
- **Format:** JSON (also supports `format=excel`; legacy docs mention XML but JSON is live default)
- **Auth:** none   |   **Rate limit:** no `X-RateLimit-*` headers observed; no documented caps; CORS fully open (`Access-Control-Allow-Origin: *`)
- **Probe status:** LIVE-CONFIRMED — HTTP 200, `Content-Type: application/json`, 930 KB payload, 6 527 data rows parsed successfully
- **Region mapping:** asserts LatinAmerica (covers all 33 ECLAC member states + Caribbean islands; iso3 field present per row)
- **Topic mapping:** Demographic & Social / Economic / Environmental / SDG multi-domain → Business / Science / Other; must-infer per indicator theme
- **Signals yielded:** points? NO   mentions? NO   tone? NO — pure numeric time-series; no engagement metadata
  - Closest proxy field: `body.data[].value` (numeric macro indicator value, e.g. `"0.01153122"`)
- **externalId (dedup key):** composite — `indicator_id` + `iso3` + dimension member ids; e.g. `3127::ARG::dim_208=216::dim_57113=57116::dim_29117=29172`; no single opaque UUID per row
- **Sample response shape:**
  ```json
  {
    "header": { "name": "uneclac cepalstat api", "version": "1.9.13", "success": true, "code": 200, "timestamp": 1781697641 },
    "body": {
      "metadata": {
        "indicator_id": 3127,
        "indicator_name": "Public social expenditure ... (as a percentage of GDP)",
        "unit": "As a percentage of gross domestic product (GDP).",
        "last_update": "2024-11-12",
        "theme": "Database of expenses",
        "area": "Public expenditure according to the classification of the functions of government"
      },
      "dimensions": [
        { "id": 208, "name": "Country__ESTANDAR", "members": [ { "name": "Argentina", "id": 216, "iso3": "ARG" } ] },
        { "id": 29117, "name": "Years__ESTANDAR", "members": [ { "name": "2000", "id": 29172 } ] }
      ],
      "data": [
        { "value": "0.01153122", "source_id": 1635, "notes_ids": "", "iso3": "ARG", "dim_208": 216, "dim_57113": 57116, "dim_57078": 57098, "dim_29117": 29172 }
      ],
      "sources": [ { "id": 1635, "description": "Argentina, Ministry of Finance, National Budget Office", "organization_acronym": "ECLAC", "organization_name": "Economic Commission for Latin America and the Caribbean" } ],
      "credits": [ { "id": 0, "description": "2026-06-17" }, { "id": 1, "description": "CEPALSTAT" } ]
    }
  }
  ```
- **Storage/ToS note:** ECLAC website usage agreement permits download/copy for personal non-commercial use only; prohibits redistribution or derivative works for resale. No explicit API-specific caching policy documented. Attribution to ECLAC/CEPALSTAT required (credits array present). Commercial or mass-redistribution use requires direct ECLAC permission.
- **Verdict:** ADOPT — adds the **only official pan-Latin-American macro-indicator signal** in the source roster; GDELT covers LatAm news events but has no structural economic context; no other existing source (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) provides UN-sanctioned LatAm socioeconomic baselines
- **Risks:**
  - ToS restricts redistribution/commercial use — legal review required before storing or surfacing data externally
  - No documented rate limits but also no SLA; large payloads (>900 KB per indicator) require paginatable fetch strategy
  - API version 1.9.13 has no versioning commitment; ECLAC may restructure without notice
  - Composite dedup key (no row UUID) complicates idempotent ingestion — adapter must hash dimension tuple
  - Coverage is primarily macro/fiscal; no engagement or sentiment signals, so usable only as SIGNAL context, not content source
