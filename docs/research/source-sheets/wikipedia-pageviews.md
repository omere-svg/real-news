# Wikipedia Pageviews API  (SourceId: wikipedia-pageviews)

- **Tier:** C  +  engagement — measures reader attention volume, not editorial content
- **Role:** SIGNAL (numeric scoring context — provides per-article view counts to rank/weight existing content records; emits no standalone story text)
- **Endpoint probed:** GET `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/{project}/all-access/{year}/{month}/all-days`
- **Format:** JSON
- **Auth:** none (HTTP User-Agent header required; authenticated access raises rate cap)  |  **Rate limit:** 200 req/min for User-Agent-compliant bots (unauthenticated); 2 000 req/min for authenticated established editors; HTTP 429 on breach (limits new as of 2026)
- **Probe status:** LIVE-CONFIRMED — two successful 200 responses:
  - `GET .../top/en.wikipedia/all-access/2024/01/all-days` → 1 000-article ranked list with `views` and `rank` fields
  - `GET .../top/he.wikipedia/all-access/2024/01/all-days` → Hebrew Wikipedia top articles including מלחמת_חרבות_ברזל (rank 3, 255 987 views)
  - `GET .../per-article/en.wikipedia/all-access/all-agents/Artificial_intelligence/daily/20240101/20240107` → daily views per article
- **Region mapping:** must-infer from `project` field (e.g. `he.wikipedia` → Israel; `en.wikipedia` → World/US); proposed per-bloc Region: **World** (multi-project coverage supports Israel, US, EU, and more by selecting project slug)
- **Topic mapping:** must-infer — no native category; article title maps to Topic via NLP or lookup against existing records (AI/Geopolitics/Politics/Sports/Business/Science/Other)
- **Signals yielded:**
  - **points** (view count): `$.items[*].articles[*].views` (integer, e.g. 255987) — primary signal
  - **rank**: `$.items[*].articles[*].rank` (integer, 1 = most viewed) — secondary ordering signal
  - **mentions**: not present
  - **tone**: not present
- **externalId (dedup key):** composite `{project}:{article}:{year}{month}` e.g. `he.wikipedia:מלחמת_חרבות_ברזל:202401`; per-article endpoint uses `{project}:{article}:{timestamp}` e.g. `en.wikipedia:Artificial_intelligence:2024010100`
- **Sample response shape** (top endpoint, he.wikipedia, 2024-01):
  ```json
  {
    "items": [{
      "project": "he.wikipedia",
      "access": "all-access",
      "year": "2024",
      "month": "01",
      "day": "all-days",
      "articles": [
        {"article": "עמוד_ראשי",         "views": 620914, "rank": 1},
        {"article": "מיוחד:חיפוש",       "views": 319495, "rank": 2},
        {"article": "מלחמת_חרבות_ברזל", "views": 255987, "rank": 3},
        {"article": "עידן_עמדי",         "views": 220856, "rank": 4},
        {"article": "פייסבוק",           "views": 139089, "rank": 5}
      ]
    }]
  }
  ```
- **Storage/ToS note:** Pageviews data is produced by Wikimedia Analytics and released under CC0 (public domain) — no attribution clause for the metrics themselves. Underlying article content (if fetched separately) is CC BY-SA 4.0. Caching is permitted and encouraged; bulk historical dumps available at dumps.wikimedia.org. User-Agent header mandatory; omitting it may result in IP block.
- **Verdict:** ADOPT — adds **pure attention-volume scoring** across any Wikipedia language edition, enabling real-time detection of which topics are surging in public interest (especially `he.wikipedia` for Israel-region salience); no other existing source (HN/arXiv/GDELT/Knesset/SEC/Wikipedia content adapter) provides this cross-lingual reader-attention axis.
- **Risks:** Rate limits tightened in 2026 (200 req/min unauthenticated) — multi-project polling at daily granularity may need pacing or authenticated bot account. Top-pages list is capped at 1 000 articles per month; long-tail articles need per-article endpoint calls. `Special:` and `File:` namespace entries in the top list must be filtered as noise. No sentiment or mention count — purely volumetric.
