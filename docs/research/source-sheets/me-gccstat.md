# GCC Statistical Centre (GCC-Stat)  (SourceId: me-gccstat)

- **Tier:** A — primary-official intergovernmental statistics body for the six Gulf Cooperation Council states
- **Role:** SIGNAL (numeric scoring context — macroeconomic, demographic, trade and social time-series; no article-style content records)
- **Endpoint probed:** `GET https://sdmx.marsa.gccstat.org/FusionRegistry/ws/public/sdmxapi/rest/data/GCCSTAT.DCD,DF_DCD_AGR,1.0?startPeriod=2023&endPeriod=2023` (Accept: application/xml)
- **Format:** SDMX-ML 2.1 (StructureSpecificData XML); JSON-Stat not supported (returns 406 on `application/vnd.sdmx.data+json`)
- **Auth:** none   |   **Rate limit:** none documented; portal self-describes as open-data; no `X-RateLimit` headers observed
- **Probe status:** LIVE-CONFIRMED (HTTP 200, valid SDMX-ML payload with real observations)
- **Region mapping:** asserts MiddleEast | GCC member-state dimension `CL_COM_AREA_GEO_FLAT_ALPHA3` carries ISO-3166-1 alpha-3 codes (ARE, SAU, QAT, KWT, BHR, OMN)
- **Topic mapping:** Agriculture → Science/Business; National Accounts → Business; Labour → Business; Demographics → Science; Trade → Geopolitics/Business; Environment → Science; Education/Health → Science
- **Signals yielded:** points? NO   mentions? NO   tone? NO  — purely numeric statistical observations; no engagement metadata. `OBS_VALUE` carries the measure value; `OBS_STATUS` (if present) carries quality flags
- **externalId (dedup key):** composite SDMX key = `agencyID + ":" + flowID + ":" + seriesKey + ":" + TIME_PERIOD`  
  Example: `GCCSTAT.DCD:DF_DCD_AGR:CL_COM_AREA_GEO_FLAT_ALPHA3=ARE+AGRICULTURE_SUBJECT_2=08_03+CL_COM_UNIT=NO+CL_COM_FREQUENCY=A:2023`
- **Sample response shape:**
  ```xml
  <message:Sender id="GCC_STAT"/>
  <Series CL_COM_AREA_GEO_FLAT_ALPHA3="ARE"
          AGRICULTURE_SUBJECT_2="08_03"
          CL_COM_UNIT="NO"
          CL_COM_FREQUENCY="A">
    <Obs TIME_PERIOD="2023" OBS_VALUE="34169"/>
  </Series>
  <Series CL_COM_AREA_GEO_FLAT_ALPHA3="ARE"
          AGRICULTURE_SUBJECT_2="02_01"
          CL_COM_UNIT="H"
          CL_COM_FREQUENCY="A">
    <Obs TIME_PERIOD="2023" OBS_VALUE="2048411"/>
  </Series>
  ```
  — 227 dataflows available across Agriculture, National Accounts, CPI, Trade, Labour, Education, Health, Environment, GCC Economic Diversification Index, GCC Economic Integration Index scores, competitive rankings, and more.
- **Storage/ToS note:** Portal terms explicitly allow free copying, use, public transmission, and modification provided GCC-Statistical Centre is cited as source with the website URL. No caching prohibition. No rate-limit clause. Commercial use is not restricted. Content that is modified must note the modification.
- **Verdict:** TRIAL — adds the only authoritative GCC/Gulf-bloc macroeconomic and social time-series axis; none of the existing six sources (HN, arXiv, GDELT, Knesset, SEC EDGAR, Wikipedia) carry Gulf-state official statistics with stable SDMX versioned flows.
- **Risks:** (1) Portal is hosted on `marsa.gccstat.org` — a project-specific subdomain that could be deprecated if the MARSA project ends; main `gccstat.org` has no equivalent machine-readable API. (2) SDMX-XML-only (no JSON); requires XML parsing overhead. (3) Annual frequency for most indicators — very low cadence for a real-time news aggregator. (4) No engagement signals (points/mentions/tone) — pure statistical context; useful only to enrich stories about Gulf economies, not to surface news items directly. (5) Geo-restriction unclear but no evidence of IP blocking in probe.
