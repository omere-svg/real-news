# WHO Disease Outbreak News  (SourceId: who-outbreaks)

- **Tier:** A — primary/official; the World Health Organization's authoritative outbreak/epidemic situation reports (DONs).
- **Role:** STORY (one RawItem per Disease Outbreak News item). No native engagement/tone fields → STORY-only.
- **Endpoint probed:** `GET https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDate desc&$top=N`
- **Format:** JSON (OData v4 — `@odata.context` + `value[]`; same family as the Knesset OData adapter).
- **Auth:** none (keyless)  |  **Rate limit:** undocumented; full unpaged payload is large (~270 KB) — always page with `$top` + `$orderby`. Respect the project's `maxResponseBytes` cap (ADR-0023).
- **Probe status:** LIVE-CONFIRMED 2026-06-28 (HTTP 200, valid OData JSON).
- **⚠ Ordering gotcha:** default order is **oldest-first** (probe returned 2006 records). MUST request `$orderby=PublicationDate desc` (URL-encode the space) to get current outbreaks, else the tick ingests ancient items.
- **Region mapping:** must-infer — the title names the country (e.g. "Avian influenza – situation in Egypt"). Default Topic-region **World**; classifier may reassign `Israel` on the rare IL item.
- **Topic mapping:** native → **Health** (the new Topic). Always Health; no per-item category needed.
- **Signals yielded:** points? NO | mentions? NO | tone? NO. STORY content only — contributes to corroboration, not scoring weight.
- **externalId (dedup key):** `Id` (GUID, e.g. `"32b088d3-994f-4813-842b-7decdcd1a3be"`) — stable. `UrlName` (e.g. `2006_03_20-en`) is a human-readable secondary key and builds the public link.
- **Human link:** `https://www.who.int/emergencies/disease-outbreak-news/item/<UrlName>` (`ItemDefaultUrl` is a relative path).
- **Body text:** `Overview` is **HTML** ("what happened" lede) — strip markup (the project already strips markup for deterministic summaries, ROADMAP §2). `Summary` is often empty; prefer `Overview`.
- **Sample response shape:**
  ```json
  {
    "@odata.context": "https://www.who.int/api/news/$metadata#diseaseoutbreaknews(...)",
    "value": [{
      "Id": "32b088d3-994f-4813-842b-7decdcd1a3be",
      "Title": "Avian influenza – situation in Egypt",
      "PublicationDate": "2006-03-20T00:00:00Z",
      "UrlName": "2006_03_20-en",
      "ItemDefaultUrl": "/2006_03_20-en",
      "Overview": "<p><b>20 March 2006</b></p><p>The Ministry of Health in Egypt has confirmed ...</p>",
      "Summary": "", "Assessment": "", "Advice": ""
    }]
  }
  ```
- **Storage/ToS note:** WHO content is public-interest health information published for dissemination; metadata + summary + link caching is the intended use. Attribution to WHO. (Use WHO IGO CC terms; link out, don't republish wholesale.)
- **Verdict:** ADOPT (keyless wave) — the authoritative feed for the new **Health** Topic; covers epidemics/outbreaks no current source touches. OData mirrors the existing Knesset pattern, so the adapter is low-cost.
- **Risks:** (1) the oldest-first default — always `$orderby desc`; (2) `Overview` HTML must be stripped; (3) low cadence (DONs are intermittent) — Health may be sparse some ticks, acceptable; (4) large unpaged payload — always page.
