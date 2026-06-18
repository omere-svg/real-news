# CrossRef  (SourceId: crossref)

- **Tier:** B  +  neutral-aggregator (indexes ~160 M DOI-registered works from 17 000+ publishers; CrossRef itself does not publish — it is a DOI registration agency acting as neutral broker)
- **Role:** SIGNAL (primary use: citation-count scoring context); STORY potential is weak — most records lack full-text, and abstracts are often absent or copyright-restricted by the originating publisher
- **Endpoint probed:** GET `https://api.crossref.org/works?query=climate+change&rows=2&mailto=omer.e@fellowship.masterschool.com`
- **Format:** JSON (Crossref Unified Resource API, message-version 1.0.0)
- **Auth:** none for public pool; `mailto=` param grants Polite Pool (separate faster machines); paid Crossref Plus for higher limits + premium fields  |  **Rate limit:** 50 req/s advertised in `X-Rate-Limit-Limit` / `X-Rate-Limit-Interval` headers; Plus tier removes cap
- **Probe status:** LIVE-CONFIRMED (HTTP 200, `"status":"ok"`, parsed 2 items; `total-results`: 1 403 038 for test query)
- **Region mapping:** must-infer (no geographic field; institution ROR/ORCID affiliations can be resolved but are not surfaced by default) → proposed per-bloc: **World**
- **Topic mapping:** `subject` field (Scopus category list, e.g. "Biochemistry") → Science; `container-title` journal name can map AI/Business/Other; must-infer for Politics/Geopolitics/Sports
- **Signals yielded:**
  - **points** (citation proxy): `message.items[*].is-referenced-by-count` (integer; e.g. 42 014 for AlphaFold paper)
  - **outgoing refs**: `message.items[*].references-count` (integer; e.g. 84)
  - **relevance score**: `message.items[*].score` (float; search-query relevance, not engagement; e.g. 19.80)
  - **mentions**: none (no altmetric / social mention data)
  - **tone**: none (no sentiment field)
- **externalId (dedup key):** `message.items[*].DOI`  — example: `"10.1038/s41586-021-03819-2"`  (globally unique, stable, used as canonical identifier across all scholarly infrastructure)
- **Sample response shape:**
  ```json
  {
    "DOI": "10.1038/s41586-021-03819-2",
    "title": ["Highly accurate protein structure prediction with AlphaFold"],
    "type": "journal-article",
    "container-title": ["Nature"],
    "published": {"date-parts": [[2021, 7, 15]]},
    "is-referenced-by-count": 42014,
    "references-count": 84,
    "score": 1.0,
    "abstract": "... (CC-BY 4.0 licensed in this case) ...",
    "author": [{"given": "John", "family": "Jumper", "ORCID": "0000-0001-6169-6580"}]
  }
  ```
- **Storage/ToS note:** CrossRef explicitly encourages caching — "cache data so you don't request the same data over and over again." Bibliographic metadata itself is not copyrighted and free to use. Abstracts may be publisher-copyright-restricted; store only when the item's `license` field confirms open access (CC-BY or similar). Attribution: content licensed CC-BY 4.0; cite CrossRef as source.
- **Verdict:** TRIAL — adds **citation-count as a Science-domain engagement proxy** (is-referenced-by-count), a signal absent from all six existing sources (HN has points but only for web links, arXiv has no citation counts natively, GDELT/Knesset/SEC/Wikipedia have no peer-review citation signal at all)
- **Risks:**
  1. **Signal sparsity**: `is-referenced-by-count` is only meaningful for articles older than ~1 year; newly published DOIs start at 0, making it a lagging indicator.
  2. **Abstract availability**: ~50 % of records have no abstract; publisher copyright restricts storage of the rest unless license is open.
  3. **No STORY value at scale**: CrossRef does not hold full text; it is a metadata broker. Treating it as a STORY source requires always pairing with arXiv/PubMed for content, which duplicates ingestion complexity.
  4. **Rate cap**: Anonymous pool can be throttled; Polite Pool (mailto=) is free but undocumented SLA; Plus tier is paid.
  5. **Scope creep**: 160 M records span all disciplines including medicine, law, and arts — broad enough to require aggressive subject-filtering to stay relevant to Project Horizon's news intelligence focus.
