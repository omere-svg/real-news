# GDACS — Global Disaster Alert and Coordination System  (SourceId: gdacs)

- **Tier:** A — primary-official; operated by the European Commission Joint Research Centre (JRC) and UN OCHA as an inter-agency system.
- **Role:** STORY (emits RawItem content — each alert is a discrete georeferenced disaster event record)
- **Endpoint probed:** `GET https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventtype=EQ&alertlevel=Orange&pagesize=1`
- **Format:** GeoJSON (FeatureCollection); also parallel RSS 2.0 + GeoRSS at `https://www.gdacs.org/xml/rss.xml`
- **Auth:** none  |  **Rate limit:** not formally published; feed refreshes ~hourly; pacing to 1 req/min is prudent
- **Probe status:** LIVE-CONFIRMED — HTTP 200, valid GeoJSON FeatureCollection with parsed sample (June 17 2026)
- **Region mapping:** asserts per-event `iso3` / `affectedcountries[]` fields + `geo:lat` / `geo:long`; maps to World by default, refine to specific region via iso3 lookup
- **Topic mapping:** eventtype codes (EQ/FL/TC/DR/VO/WF) → Geopolitics (humanitarian/security impact) or Other (pure natural science events); no politics/AI/sports/business/finance native categories
- **Signals yielded:**
  - points? — `alertscore` (integer 1–3; Green=1, Orange=2, Red=3) and `episodealertscore` (float, e.g. 1.97557) at `properties.alertscore` / `properties.episodealertscore`
  - mentions? — none (no comment or engagement count)
  - tone? — `alertlevel` string (Green/Orange/Red) at `properties.alertlevel` acts as a coarse severity tone signal
- **externalId (dedup key):** composite `{eventtype}{eventid}` — e.g. `"EQ1546719"` (this is also the RSS `<guid>` value); alternatively `properties.eventid` (integer, e.g. `1546719`) combined with `properties.episodeid` (`1712478`) for episode-level dedup
- **Sample response shape:**
  ```json
  {
    "eventtype": "EQ",
    "eventid": 1546719,
    "episodeid": 1712478,
    "name": "Earthquake in China",
    "alertlevel": "Orange",
    "alertscore": 2,
    "episodealertscore": 1.97557264355714,
    "iso3": "CHN",
    "country": "China",
    "fromdate": "2026-06-16T09:06:55",
    "datemodified": "2026-06-16T11:35:17",
    "source": "NEIC",
    "iscurrent": "true",
    "severitydata": { "severity": 6.3, "severitytext": "Magnitude 6.3M, Depth:10km", "severityunit": "M" },
    "url": {
      "geometry": "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=EQ&eventid=1546719&episodeid=1712478",
      "report": "https://www.gdacs.org/report.aspx?eventid=1546719&episodeid=1712478&eventtype=EQ",
      "details": "https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=EQ&eventid=1546719"
    }
  }
  ```
- **Storage/ToS note:** Data provided "as is" by EC JRC / UN OCHA under an implied open-access policy (no auth required, public RSS). Terms disclaim liability and require attribution to original alert providers (NEIC, WMO, UNESCO-IOC). No explicit prohibition on caching; standard practice is to attribute GDACS and the underlying `source` field. Not for unvalidated operational decision-making per ToS.
- **Verdict:** ADOPT — adds **real-time georeferenced physical-world crisis signals** (earthquakes, floods, tropical cyclones, wildfires) that no other current source covers; GDELT covers *media reactions* to events while GDACS covers the *ground-truth triggering events* themselves, giving Horizon a causal root-event layer upstream of geopolitical coverage.
- **Risks:** Feed is auto-generated and explicitly unreviewed — `alertlevel` may carry false-positives; endpoint URL structure (`gdacsapi/api/events/geteventlist/SEARCH`) is not versioned and could change without notice; no SLA or formal API contract; EU/JRC operational continuity assumed but not guaranteed; no `totalCount` or pagination token in GeoJSON response (use `pagesize`+`pagenumber` query params, behavior under load untested).
