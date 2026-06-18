# OpenAlex  (SourceId: openalex)

- **Tier:** B  +  neutral-aggregator (indexes 316M+ scholarly works from Crossref, PubMed, DOAJ, MAG; not a primary publisher)
- **Role:** BOTH — emits RawItem content records (title, abstract, authors, DOI) AND provides SIGNAL fields (cited_by_count, fwci, citation_normalized_percentile, topics with confidence scores)
- **Endpoint probed:** GET https://api.openalex.org/works?sort=cited_by_count:desc&per_page=3&select=id,doi,title,publication_date,cited_by_count,concepts,topics,type,authorships
- **Format:** JSON
- **Auth:** free-key (keyless access allowed but capped at $0.01/day credit; free API key at openalex.org/settings/api unlocks $1/day; list queries cost $0.0001 each)  |  **Rate limit:** 10,000 requests/day free tier; x-ratelimit headers confirm per-request cost tracking; no hard req/sec cap documented but polite pool recommended
- **Probe status:** LIVE-CONFIRMED (HTTP 200; parsed 3 works; response in ~150–420 ms; headers: x-ratelimit-limit: 10000, x-ratelimit-remaining: 9998, x-ratelimit-cost-usd: 0.0001)
- **Region mapping:** must-infer (works carry authorships[].countries[], institutions[].country_code — region can be derived but is not a native field; proposed Region: World)
- **Topic mapping:** topics[].field.display_name + topics[].domain.display_name -> Science (default); topics matching "Computer Science" / "Artificial Intelligence" -> AI; no native Geopolitics/Politics/Business/Sports mapping
- **Signals yielded:**
  - points (citation popularity): `cited_by_count` (integer, e.g. 801217); `fwci` (Field-Weighted Citation Impact float, e.g. 1.1061); `citation_normalized_percentile.value` (0–1 float)
  - mentions: `referenced_works_count` (integer, how many works this cites); no comment count
  - tone: none — no sentiment field; `sustainable_development_goals[].score` is a relevance score, not sentiment
- **externalId (dedup key):** `id` field — stable OpenAlex URI, e.g. `"https://openalex.org/W3038568908"`; DOI also available at `ids.doi` for cross-source dedup
- **Sample response shape:**
  ```json
  {
    "id": "https://openalex.org/W3038568908",
    "doi": "https://doi.org/10.1585/pfr.15.2402039",
    "title": "Radiation Resistant Camera System for Monitoring Deuterium Plasma Discharges in the Large Helical Device",
    "publication_date": "2020-06-08",
    "cited_by_count": 801217,
    "fwci": 1.1061,
    "primary_topic": { "display_name": "Magnetic confinement fusion research", "score": 0.9991, "field": { "display_name": "Physics and Astronomy" } },
    "type": "article",
    "open_access": { "is_oa": true, "oa_status": "diamond" }
  }
  ```
- **Storage/ToS note:** Data is CC0 (public domain) — OpenAlex explicitly releases all data under CC0; bulk snapshots available via AWS S3; caching and redistribution permitted with no attribution clause required (though attribution encouraged). Ref: https://openalex.org/about
- **Verdict:** ADOPT — adds peer-reviewed science citation graph as a global SIGNAL layer; no existing source in HN/arXiv/GDELT/Knesset/SEC/Wikipedia provides normalized citation impact scores (fwci, percentile ranks) or cross-disciplinary topic graphs at 316M-work scale
- **Risks:** API is relatively new (launched 2022, replacing Microsoft Academic Graph); rate model changed from fully free to credit-based in 2024 — model may tighten further; keyless tier ($0.01/day) is very limited for production ingestion (approx 100 list calls/day); full bulk use requires paid plan or S3 snapshot download; no SLA on API uptime; data quality depends on Crossref/PubMed upstream feeds.
