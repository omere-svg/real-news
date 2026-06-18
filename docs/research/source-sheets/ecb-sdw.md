# ECB Statistical Data Warehouse  (SourceId: ecb-sdw)

- **Tier:** A — primary-official (central bank publishing its own statistical data)
- **Role:** SIGNAL (numeric scoring context — macro rates/FX data, not prose content records)
- **Endpoint probed:** GET `https://data-api.ecb.europa.eu/service/data/EXR/M.USD.EUR.SP00.A?format=jsondata&detail=dataonly&lastNObservations=3`
- **Format:** SDMX-JSON (jsondata dialect; also supports CSV and SDMX-ML 2.1)
- **Auth:** none   |   **Rate limit:** not documented; supports `If-Modified-Since` for conditional polling; no throttle headers observed
- **Probe status:** LIVE-CONFIRMED (HTTP 200, parsed series key `0:0:0:0:0`, observations with timestamps and float values)
- **Region mapping:** asserts EU | also covers World FX pairs (USD, GBP, JPY, CNY vs EUR)
- **Topic mapping:** Exchange Rates / Interest Rates / Macro Indicators -> Business (primary); Geopolitics (secondary for currency stress signals)
- **Signals yielded:** points? NO   mentions? NO   tone? NO — yields numeric observation values (float exchange rates / rates) at `dataSets[0].series["0:0:0:0:0"].observations["<idx>"][0]`; no engagement metadata
- **externalId (dedup key):** composite of dataflow + series key + time period — e.g. `EXR/M.USD.EUR.SP00.A/2026-05`; constructed from `structure.dimensions.observation[0].values[].id` (time period string) + dataflow ref in `structure.links[0].href`
- **Sample response shape:**
  ```json
  {
    "header": { "id": "236d0f8c-...", "prepared": "2026-06-17T13:51:44.021+02:00", "sender": {"id":"ECB"} },
    "dataSets": [{ "action": "Replace", "series": {
      "0:0:0:0:0": { "observations": { "0": [1.1558], "1": [1.1706], "2": [1.1673] } }
    }}],
    "structure": {
      "dimensions": { "series": [{"id":"FREQ"},{"id":"CURRENCY"},{"id":"CURRENCY_DENOM"},{"id":"EXR_TYPE"},{"id":"EXR_SUFFIX"}],
                      "observation": [{"id":"TIME_PERIOD","values":[{"id":"2026-03"},{"id":"2026-04"},{"id":"2026-05"}]}] }
    }
  }
  ```
- **Storage/ToS note:** ECB permits free reproduction and caching provided ECB is cited as the source and data is represented accurately. Commercial republication of authored research requires written permission, but statistical data (SDW) is not authored works — free use with attribution is standard ECB policy. No explicit prohibition on server-side caching found.
- **Verdict:** ADOPT — adds the **real-time official macro/FX rate axis**: the only source in the current six (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) that supplies authoritative central-bank numerical signals (EUR exchange rates, ECB key interest rates, money-market rates) usable as economic-stress context for scoring Business and Geopolitics stories.
- **Risks:** (1) No documented rate limit but no SLA either — ECB SDW is a public service and could enforce throttling without notice; implement exponential back-off. (2) Data is statistical/numeric, not prose — requires a separate enrichment step to attach signals to RawItems rather than producing them. (3) Series key space is large; callers must pre-select relevant dataflows (EXR, FM, MIR, BSI) to avoid unbounded queries. (4) SDMX key syntax is non-trivial to construct correctly; malformed keys return 404 silently.
