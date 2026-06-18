# European Parliament Open Data Portal  (SourceId: eu-parliament)

- **Tier:** A  +  primary-official (operated directly by the European Parliament, CC BY 4.0)
- **Role:** STORY (emits RawItem content — plenary votes, legislative procedures, speeches, parliamentary questions)
- **Endpoint probed:** GET https://data.europarl.europa.eu/api/v2/meetings?limit=2&offset=0  (Accept: application/ld+json)
- **Format:** JSON-LD (default); also RDF/XML, Turtle, Atom XML for feed variants
- **Auth:** none  |  **Rate limit:** 500 requests per 5 minutes (from API docs); User-Agent header strongly recommended
- **Probe status:** LIVE-CONFIRMED (HTTP 200, valid JSON-LD with data array parsed)
- **Region mapping:** asserts EU | no inference needed (European Parliament is EU-only by definition)
- **Topic mapping:** plenary votes + legislative procedures → Politics; speeches + parliamentary questions → Politics/Geopolitics (depending on dossier subject) | must-infer per procedure topic
- **Signals yielded:** points? NO  |  mentions? NO  |  tone? NO  — vote-results items carry `activity_id`, `activity_label`, document references, and procedure linkage but NO numeric engagement metrics; vote tallies (for/against/abstain) exist in linked PV documents but are not exposed as top-level JSON fields in the v2 REST API
- **externalId (dedup key):** `activity_id`  — example: `"MTG-PL-2014-01-14-VOT-ITM-344668-4"` (also exposed as `id` in ELI-DL URI form: `"eli/dl/event/MTG-PL-2014-01-14-VOT-ITM-344668-4"`)
- **Sample response shape:**
```json
{
  "id": "eli/dl/event/MTG-PL-2014-01-14-VOT-ITM-344668-4",
  "type": "Activity",
  "activity_id": "MTG-PL-2014-01-14-VOT-ITM-344668-4",
  "activity_date": "2014-01-14",
  "activity_label": { "fr": "Émissions de CO2 des véhicules utilitaires légers neufs" },
  "had_activity_type": "def/ep-activities/PLENARY_VOTE_RESULTS",
  "based_on_a_realization_of": ["eli/dl/doc/A-7-2013-0168"],
  "notation_dlvId": "344668"
}
```
- **Storage/ToS note:** Licensed CC BY 4.0 — caching and redistribution permitted with attribution ("Source: European Parliament"). No personal-data storage in User-Agent per EU Regulation 2018/1725.
- **Verdict:** ADOPT  —  adds the **EU legislative branch** as a primary-official source; no existing source (HN=engagement, arXiv=preprints, GDELT=media-events, Knesset=IL-only, SEC=US-corporate, Wikipedia=encyclopaedic) covers EU Parliament voting records and legislative procedure tracking.
- **Risks:** (1) API versioning — v2 is current but EP has history of breaking changes between major versions; (2) rate cap of 500 req/5 min is generous but shared across all callers from one IP; (3) JSON-LD with ELI-DL ontology requires context resolution (`context.jsonld`) to fully dereference IRIs — adds parsing complexity; (4) multilingual labels (24 EU languages) require language selection at query time; (5) vote tallies (for/against/abstain counts) are embedded in linked PDF/XML minutes, not in the REST JSON directly — limits SIGNAL use without secondary fetch.
