# Eurostat API  (SourceId: eu-eurostat)

- **Tier:** A — primary-official; published directly by Eurostat, the statistical office of the European Union (EU institution under Treaty mandate)
- **Role:** SIGNAL (numeric scoring context; emits official EU macro time-series — GDP, inflation, unemployment, trade — not narrative content records)
- **Endpoint probed:** GET `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tec00001?format=JSON&lang=EN&sinceTimePeriod=2025`
- **Format:** JSON-stat 2.0 (`"version":"2.0"`, `"class":"dataset"`) — keyless public REST; also supports SDMX-ML
- **Auth:** none   |   **Rate limit:** not published in headers or docs; response headers show no `X-RateLimit-*`; `Access-Control-Allow-Origin: *` (open CORS); `Access-Control-Allow-Methods: GET` only; pacing: treat as courteous polling (1 req/s recommended)
- **Probe status:** LIVE-CONFIRMED (HTTP 200 `application/json` + parsed JSON-stat sample; no key required)
- **Region mapping:** asserts EU (EU27 member states, Euro-area aggregates, and EU candidate countries; `geo` dimension includes `EU27_2020`, `EA20`, `EA21` and all ISO 2-letter country codes)
- **Topic mapping:** macro economic/fiscal/social indicators -> Business / Science (GDP, inflation, unemployment, trade balance, government debt, energy, demographics); must-infer per dataset — no native "topic" field; dataset IDs encode theme (e.g. `tec*` = key indicators, `ei_*` = short-term, `nama_*` = national accounts)
- **Signals yielded:** points? NO  |  mentions? NO  |  tone? NO  — yields `value[pos]` (float/null), `status[pos]` (observation quality flags: `p`=provisional, `e`=estimated, `b`=break), `updated` (ISO timestamp). Pure numeric signal; zero engagement metadata.
  - Signal JSON paths: `value["<pos>"]` (numeric), `status["<pos>"]` (`p`/`e`/`b`), `updated` (dataset-level freshness), `extension.id` (dataset code), `dimension.geo.category.label["<code>"]` (country name), `dimension.time.category.index` (year keys)
- **externalId (dedup key):** composite `{extension.id}:{geo_code}:{time_period}:{unit_code}` — e.g. `TEC00001:EU27_2020:2025:CP_MEUR`; DOI also stable: `10.2908/TEC00001`
- **Sample response shape:**
  ```json
  {
    "version": "2.0",
    "class": "dataset",
    "label": "Gross domestic product at market prices",
    "source": "ESTAT",
    "updated": "2026-06-11T23:00:00+0200",
    "id": ["freq","na_item","unit","geo","time"],
    "size": [1, 1, 3, 45, 1],
    "value": { "91": 15951938.7, "93": 15742945.3, "0": 41650 },
    "status": { "4": "p", "15": "e" },
    "extension": {
      "id": "TEC00001",
      "agencyId": "ESTAT",
      "lang": "EN",
      "version": "1.0",
      "datastructure": { "id": "TEC00001", "agencyId": "ESTAT", "version": "125.0" },
      "annotation": [
        { "type": "CREATED", "date": "2008-10-30T12:20:30+0100" },
        { "type": "DISSEMINATION_DOI_XML", "title": "...doi.org/10.2908/TEC00001..." }
      ]
    },
    "dimension": {
      "geo": {
        "category": {
          "index": { "EU27_2020": 0, "BE": 4 },
          "label": { "EU27_2020": "European Union - 27 countries (from 2020)", "BE": "Belgium" }
        }
      }
    }
  }
  ```
- **Storage/ToS note:** Eurostat data is published under the European Commission's reuse policy (Commission Decision 2011/833/EU); free reuse for commercial and non-commercial purposes with attribution required: "Source: Eurostat, [dataset title], [DOI/URL], [access date]". Caching permitted. No bulk-download embargo. API is keyless and public.
- **Verdict:** ADOPT — adds the **official EU institutional macro-statistics axis**: authoritative GDP, inflation, unemployment, trade, and government-debt time-series for all 27 EU member states, filling the EU-region numeric-context gap that World Bank (global, lower frequency) and no other existing source (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) covers at EU-granularity with official provenance.
- **Risks:** data latency (annual/quarterly cadence; most-recent year often provisional `p` or missing); no published SLA or rate limit (add per-request back-off); dataset IDs can be deprecated across Eurostat database restructurings (monitor TOC endpoint); JSON-stat positional value encoding requires dimension-aware decode logic (not trivial flat JSON); EU-member coverage only — non-EU countries appear as comparators but are not the primary focus.
