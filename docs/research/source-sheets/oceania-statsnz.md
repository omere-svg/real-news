# Stats NZ – Aotearoa Data Explorer API  (SourceId: oceania-statsnz)

- **Tier:** A — primary-official national statistics office (Te Tari Tatau, New Zealand government)
- **Role:** SIGNAL (numeric time-series observations — GDP, population, employment, trade, CPI — not editorial content records)
- **Endpoint probed:** `GET https://api.data.stats.govt.nz/rest/dataflow/STATSNZ/all` (metadata listing, no auth)
- **Format:** SDMX-ML 2.1 (XML) for structure/metadata; CSV (`format=csvfilewithlabels`) for data observations
- **Auth:** free-key (Azure API Management subscription key: header `Ocp-Apim-Subscription-Key`) — register free at https://portal.apis.stats.govt.nz  |  **Rate limit:** "fair use" throttling enforced; key sharing leads to throttling per portal docs; no published hard cap found
- **Probe status:** LIVE-CONFIRMED — `GET /rest/dataflow/STATSNZ/all` returned HTTP 200 + SDMX-ML with 911 dataflow definitions. Data endpoints (`/rest/data/*`) return HTTP 401 without a key, confirming free-key auth is required for data retrieval.
- **Region mapping:** asserts Oceania (New Zealand official statistics); proposed per-bloc Region: **Oceania**
- **Topic mapping:** AGR→Science/Other, BDS/INC/LEED/POPES→Business, CEN→Other, CORR/JUS→Politics, HES→Other, PRD→Business/Science. No direct AI or Sports topics. Must-infer at ingest time from dataflow ID prefix.
- **Signals yielded:** no points, no mentions, no tone. Pure quantitative time-series (OBS_VALUE field in CSV rows). Not applicable as engagement signal source.
- **externalId (dedup key):** `DataflowID` + period key, e.g. `POPES_CPP_023.NZ.2024-Q1` (constructed from agencyID + dataflow id + dimension key + time period). Within SDMX CSV: columns are dimension codes + `OBS_VALUE` + `OBS_STATUS`.
- **Sample response shape** (from live probe of `/rest/dataflow/STATSNZ/all`):
  ```xml
  <message:Structure xmlns:message="…sdmxml/schemas/v2_1/message" …>
    <message:Header>
      <message:Prepared>2026-06-16T20:29:42Z</message:Prepared>
      <message:Sender id="Unknown" />
    </message:Header>
    <message:Structures>
      <structure:Dataflows>
        <structure:Dataflow id="AGR_AGR_002" agencyID="STATSNZ" version="1.0">
          <common:Name xml:lang="en">Horticulture by Regional Council</common:Name>
          <structure:Structure><Ref id="AGR_AGR_002" … /></structure:Structure>
        </structure:Dataflow>
        <!-- 911 dataflows total: AGR, BDS, CEN13/18/23, CORR, HES, INC,
             INJ, IWI18, JUS, LEED, POPES, POPPR, PRD -->
      </structure:Dataflows>
    </message:Structures>
  </message:Structure>
  ```
  Data CSV rows (auth required): `AREA,YEAR,OBS_VALUE,OBS_STATUS` — e.g. `New Zealand,2024,5163900,`
- **Storage/ToS note:** Stats NZ content is licensed under Creative Commons Attribution 4.0 International (CC BY 4.0) — confirmed on www.stats.govt.nz/about-us/copyright-and-licensing/. Caching and storage permitted with attribution "Source: Stats NZ". API Terms of Use linked from portal.apis.stats.govt.nz (full text not publicly accessible without sign-in, but no non-commercial restriction indicated).
- **Verdict:** TRIAL — adds **Oceania sovereign macro-statistics (NZ census, population, employment, trade, agriculture)** as a quantitative signal layer, a region with zero coverage among the current six sources (HN/arXiv/GDELT/Knesset/SEC/Wikipedia). Blocked only by needing a free key.
- **Risks:** (1) NZ.Stat (predecessor) was closed September 2024; Aotearoa Data Explorer API is the active replacement but is still relatively new — endpoint stability not yet proven over multiple years. (2) API key registration requires a manual sign-up; no programmatic self-service. (3) SDMX-ML format requires an XML parser and SDMX schema awareness, raising adapter complexity. (4) 911 dataflows are mostly low-frequency annual/quarterly series — not a real-time or daily feed. (5) Very small country-scope: limited geopolitical signal value beyond NZ-domestic economic context.
