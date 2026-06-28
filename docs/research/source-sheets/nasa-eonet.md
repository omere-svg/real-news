# NASA EONET — Earth Observatory Natural Event Tracker  (SourceId: nasa-eonet)

- **Tier:** A — primary/official; NASA GSFC curates near-real-time natural-event metadata from authoritative instruments/agencies (USGS, JTWC, Smithsonian GVP, BYU, national met offices).
- **Role:** STORY (one RawItem per natural event) **+ optional SIGNAL** — `magnitudeValue` (storm kts, fire MW, quake M) is a native severity number that can feed `points`/significance. Modelled STORY-first; magnitude folded in as a metadata signal (BOTH-capable).
- **Endpoint probed:** `GET https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=N` (JSON) — also `/events/geojson` variant.
- **Format:** JSON (and GeoJSON FeatureCollection)
- **Auth:** none (keyless; basic use needs no `api.nasa.gov` key)  |  **Rate limit:** generous, undocumented hard cap; pace politely. No 429 seen on probe.
- **Probe status:** LIVE-CONFIRMED 2026-06-28 (HTTP 200, valid JSON; sample event "Tropical Storm Higos", category "Severe Storms", magnitude 35 kts).
- **Region mapping:** must-infer — events carry `geometry.coordinates` (lon/lat). Default Topic-region **World**; an Israel bbox test could assert `Israel`, but keep World to start.
- **Topic mapping:** `categories[].id` → **Climate**. EONET categories: Drought, Dust & Haze, Earthquakes, Floods, Landslides, Sea/Lake Ice, Severe Storms, Snow, Temperature Extremes, Volcanoes, Water Color, Wildfires, Manmade. (Earthquakes overlap with USGS — dedup by event, prefer USGS for quakes.)
- **Signals yielded:** points? `magnitudeValue` (severity, unit-dependent — normalize per category) | mentions? NO | tone? NO.
- **externalId (dedup key):** `id` — e.g. `"EONET_20671"` (stable per event). NOTE: the geojson form emits one feature *per track point*, repeating the same `id` — dedup on `id`, take the latest `date`.
- **Sample response shape:**
  ```json
  {
    "events": [{
      "id": "EONET_20671",
      "title": "Tropical Storm Higos",
      "description": null,
      "link": "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_20671",
      "closed": null,
      "categories": [{ "id": "severeStorms", "title": "Severe Storms" }],
      "sources":    [{ "id": "JTWC", "url": "https://www.metoc.navy.mil/jtwc/products/wp0826.tcw" }],
      "geometry":   [{ "magnitudeValue": 35.0, "magnitudeUnit": "kts",
                       "date": "2026-06-23T00:00:00Z", "type": "Point",
                       "coordinates": [145.7, 14.7] }]
    }]
  }
  ```
- **Storage/ToS note:** NASA content is generally public domain / open; EONET is intended for programmatic reuse. Caching permitted. Attribution to NASA/EONET courteous.
- **Verdict:** ADOPT (keyless wave) — sole real-time **Climate/Environment** physical-event feed; opens the new `Climate` Topic with objective, instrument-sourced events. Body text is thin (`description` often null) → rely on `title` + category; the deterministic summary fallback covers the "what happened".
- **Risks:** (1) `description` frequently null — low body text; (2) Earthquakes category overlaps USGS (dedup); (3) magnitude units vary by category — normalize before using as a signal; (4) `link` points at the EONET API record, not a human article — set the human link to the EONET event page or first `sources[].url`.
