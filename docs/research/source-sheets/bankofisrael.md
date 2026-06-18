# Bank of Israel  (SourceId: bankofisrael)

- **Tier:** A — primary-official; Israel's central bank publishes its own authoritative time-series via a versioned SDMX REST API with no third-party intermediary.
- **Role:** SIGNAL (numeric scoring context — daily exchange rates, interest rates, monetary aggregates, inflation expectations; no narrative content records)
- **Endpoint probed:** GET `https://edge.boi.gov.il/FusionEdgeServer/ws/public/sdmxapi/rest/data/BOI.STATISTICS/EXR/RER_USD_ILS?startperiod=2026-06-10&endperiod=2026-06-17&format=sdmx-json`
- **Format:** SDMX-JSON (via `?format=sdmx-json`) or SDMX-XML (default); both returned from the same REST path. The SDMX-JSON variant parses cleanly.
- **Auth:** none   |   **Rate limit:** not published; no API key required; no `X-RateLimit-*` headers observed. Pacing recommendation: poll once daily per series.
- **Probe status:** LIVE-CONFIRMED — HTTP 200 with full SDMX-JSON payload parsed successfully on 2026-06-17.
- **Region mapping:** asserts Israel
- **Topic mapping:** Exchange rates / monetary policy / macro indicators → Business
- **Signals yielded:** no points, no mention counts, no sentiment. Pure numeric time-series: `OBS_VALUE` (e.g. 2.912 ILS/USD). No engagement signals.
- **externalId (dedup key):** composite `SERIES_CODE + TIME_PERIOD` — e.g. `RER_USD_ILS_2026-06-16`. No single native UUID field; the combination is stable and unique.
- **Sample response shape:**
  ```json
  {
    "data": {
      "dataSets": [{
        "reportingBegin": "2026-06-10T00:00:00",
        "series": {
          "0:0:0:0:0:0": {
            "observations": {
              "0": ["2.973", 0],
              "1": ["2.965", 0],
              "2": ["2.935", 0],
              "3": ["2.907", 0],
              "4": ["2.912", 0]
            }
          }
        }
      }],
      "structure": {
        "name": "Exchange rates",
        "dimensions": {
          "series": [
            {"id": "SERIES_CODE", "values": [{"id": "RER_USD_ILS", "name": "Representative Exchange Rate US dollar/New Israeli shekel"}]},
            {"id": "FREQ",         "values": [{"id": "D", "name": "Daily"}]},
            {"id": "BASE_CURRENCY","values": [{"id": "USD"}]},
            {"id": "COUNTER_CURRENCY","values": [{"id": "ILS"}]}
          ],
          "observation": [{"id": "TIME_PERIOD", "values": [{"id": "2026-06-16"}]}]
        }
      }
    }
  }
  ```
- **Storage/ToS note:** Bank of Israel terms state users "may not copy, publish, disseminate, transmit or sell any information made available on this site without the prior written consent of the BOI." Internal caching for pipeline deduplication is likely permissible, but re-publishing derived data requires written permission. The CONF_STATUS field in each observation is set to `F` ("Free for publication") on all public series; this may support a fair-use reading for internal aggregation, but legal confirmation is advised before any public display.
- **Verdict:** ADOPT — adds the only Tier-A, sovereign-official ILS/USD and Israeli monetary-policy signal feed in the source set. No existing source (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) provides official central-bank numeric context for Israeli business stories.
- **Risks:**
  - **ToS ambiguity:** Blanket "no redistribution" clause may require written consent for any downstream display; needs legal sign-off.
  - **Domain/path stability:** Primary data endpoint is `edge.boi.gov.il` (gov.il subdomain). The SDMX v2 path (`/FusionEdgeServer/sdmx/v2/`) returned 404; only the alternate `/FusionEdgeServer/ws/public/sdmxapi/rest/` path works — undocumented URL drift risk.
  - **No rate-limit header:** Absence of published rate-limit policy creates uncertainty; aggressive polling could result in silent blocking.
  - **SDMX series name mapping inconsistency:** The `/dataflow` catalogue shows some English names apparently mislabeled (e.g. `EXR` labelled "ACH-MASAV", `CHEQUES` labelled "Exchange rates"). Series discovery requires manual validation against actual data.
  - **No geo-restriction observed**, but data is Israel-scoped by definition.
