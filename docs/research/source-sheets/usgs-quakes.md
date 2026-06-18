# USGS Earthquakes  (SourceId: usgs-quakes)

> ⛔ **PARKED / RETIRED from the active plan ([ADR-0021](../../adr/0021-lean-media-aware-source-expansion.md)).**
> Dropped from the MVP source set (not relevant to the user). `usgs-quakes` slug reserved only if
> physical-event coverage is wanted later. Sheet kept as reference.

- **Tier:** A  +  primary-official (U.S. federal agency, authoritative seismic catalog; data is U.S. public domain)
- **Role:** BOTH — emits RawItem content records (each earthquake is a discrete event with title, location, magnitude) and provides a quantitative signal (`sig` score + alert level)
- **Endpoint probed:** GET `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=3&minmagnitude=5&orderby=time`
- **Format:** GeoJSON (`FeatureCollection` wrapping `Feature` objects)
- **Auth:** none  |  **Rate limit:** not formally published; USGS docs recommend using static real-time GeoJSON feeds (updated every minute) for automated apps instead of the query API for high-frequency polling; query API supports up to 20,000 events per request
- **Probe status:** LIVE-CONFIRMED (200 OK, parsed GeoJSON sample)
- **Region mapping:** must-infer per event — `properties.place` (e.g. "25 km SSE of Tambolaka, Indonesia") plus lat/lon in `geometry.coordinates` give exact location; no single per-bloc Region — maps to **World** as default, sub-region derivable via reverse geocode or bbox filter
- **Topic mapping:** earthquake/seismic event → **Geopolitics** (natural disasters with geopolitical consequence) / **Science** (seismology data) — recommend dual-tag; native `type` field is always `"earthquake"` or similar event type
- **Signals yielded:**
  - `sig` (significance score, integer, higher = more significant): `features[*].properties.sig` — e.g. `400` for M5.1; acts as a points-like importance rank
  - `felt` (number of "felt it" reports submitted): `features[*].properties.felt` — crowd-sourced mention proxy, often null for remote events
  - `cdi` (Community Internet Intensity — reported shaking intensity, 0–10): `features[*].properties.cdi`
  - `mmi` (Modified Mercalli Intensity from ShakeMap, 0–10): `features[*].properties.mmi`
  - `alert` (PAGER alert level — green/yellow/orange/red): `features[*].properties.alert`
  - No tone/sentiment field; `alert` is the closest severity proxy
- **externalId (dedup key):** `id` at the feature root — e.g. `"us7000stk6"` (network prefix + event code; globally unique, stable)
- **Sample response shape:**
  ```json
  {
    "type": "FeatureCollection",
    "metadata": { "count": 3, "title": "USGS Earthquakes" },
    "features": [{
      "type": "Feature",
      "id": "us7000stk6",
      "geometry": { "type": "Point", "coordinates": [119.16, -9.73, 10] },
      "properties": {
        "mag": 5.1, "place": "25 km SSE of Tambolaka, Indonesia",
        "time": 1781667858058, "updated": 1781668782040,
        "title": "M 5.1 - 25 km SSE of Tambolaka, Indonesia",
        "sig": 400, "alert": null, "tsunami": 0,
        "felt": null, "cdi": null, "mmi": null,
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000stk6",
        "magType": "mb", "type": "earthquake", "status": "reviewed"
      }
    }]
  }
  ```
- **Storage/ToS note:** USGS-authored data is U.S. Public Domain (17 U.S.C. § 105) — free to cache, store, and redistribute with attribution requested ("U.S. Geological Survey / Department of the Interior"). No commercial-use restriction. Non-USGS imagery on their site may be copyrighted but the earthquake data itself is not.
- **Verdict:** ADOPT — adds **real-time physical-world event detection** (seismic activity as a geopolitical and humanitarian trigger) — none of the existing six sources (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) emit discrete natural-disaster events with authoritative severity scores; USGS fills that gap with a keyless, public-domain, globally-scoped feed.
- **Risks:**
  - No published SLA or rate-limit guarantees; heavy polling of the query API may be throttled without warning — mitigate by using the static GeoJSON feeds (updated every minute) for real-time ingestion.
  - `sig` score methodology can change between USGS catalog versions; not a user-engagement metric — treat as severity proxy, not popularity.
  - Events are revised post-detection: `updated` timestamp must be tracked to re-ingest corrected records; dedup purely on `id` without checking `updated` will miss revisions.
  - Geographic coverage is global but detection sensitivity varies by region (dense networks in US/Japan vs. sparse in parts of Africa/LatAm) — magnitude completeness is not uniform worldwide.
