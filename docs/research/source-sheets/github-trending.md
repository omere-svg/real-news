# GitHub Trending / Search Repos  (SourceId: github-trending)

- **Tier:** C  +  engagement — star/fork counts are community-voting signals, not authoritative editorial or official institutional data
- **Role:** BOTH — emits RawItem content records (repo name, description, topics, created_at) AND supplies numeric signals (stars = points proxy, forks = distribution proxy, open_issues_count = activity proxy)
- **Endpoint probed:** GET https://api.github.com/search/repositories?q=created:%3E2026-06-10+stars:%3E100&sort=stars&order=desc&per_page=3
- **Format:** JSON
- **Auth:** none (unauthenticated)  |  **Rate limit:** 10 requests/minute for search endpoint (unauthenticated); 30 req/min with a personal token. General REST API: 60 req/hour unauth, 5000/hour authed. Pacing: poll once per hour per topic window; use ETags.
- **Probe status:** LIVE-CONFIRMED — HTTP 200, parsed JSON, `total_count: 87`, full item array returned
- **Region mapping:** must-infer — repos have no native geo tag; owner location not in search payload; propose World (global developer community)
- **Topic mapping:** `topics[]` array on each repo (e.g. `["ai-agents","llm","claude-code"]`) -> AI / Science / Other; language field supplements; must-infer for non-tech topics
- **Signals yielded:**
  - points (stars): `items[*].stargazers_count` (e.g. 28632)
  - mentions (forks as distribution): `items[*].forks_count` (e.g. 1267)
  - activity proxy: `items[*].open_issues_count` (e.g. 37)
  - no native tone/sentiment field
- **externalId (dedup key):** `items[*].id` — stable numeric GitHub repo id, e.g. `1266797999`; secondary: `items[*].full_name` e.g. `"DietrichGebert/ponytail"`
- **Sample response shape:**
  ```json
  {
    "id": 1266797999,
    "full_name": "DietrichGebert/ponytail",
    "description": "Makes your AI agent think like the laziest senior dev in the room.",
    "created_at": "2026-06-12T00:52:37Z",
    "stargazers_count": 28632,
    "forks_count": 1267,
    "open_issues_count": 37,
    "topics": ["ai-agents","llm","claude-code","developer-tools"],
    "language": "JavaScript",
    "score": 1.0
  }
  ```
- **Storage/ToS note:** GitHub REST API data is publicly accessible; GitHub ToS (Section D) permits caching for reasonable periods. Attribution as "GitHub" required if surfaced to end-users. No redistribution of raw API dumps at scale. No scraping prohibition applies (this is the official API). License field per-repo varies (MIT, Apache, etc.) and affects downstream content reuse; repo metadata itself (name, stars, description) is freely cacheable.
- **Verdict:** TRIAL — adds a **real-time developer-community momentum signal** (star velocity on newly-created repos) absent from all six existing sources. HN covers some overlap but is editorial/voted; arXiv is papers only; neither surfaces nascent open-source AI/science tooling within hours of launch. The `topics[]` array enables zero-shot AI/Science topic routing. Main risk is signal noise (viral but trivial repos) — mitigated by `stars > threshold` + `created_at` window filters.
- **Risks:**
  - Rate cap: search endpoint is 10 req/min unauthenticated — a free GitHub token (no scopes needed) raises this to 30/min and general to 5000/hr; should be registered as a free-key source in production.
  - `score` field from search ranking is opaque and non-comparable across queries; do not use as a quality signal.
  - Trending ≠ significance: viral joke repos or social-media-driven spikes can dominate; need a minimum age + description length guard.
  - No native geo tagging: region inference requires owner-profile lookup (extra API call) or NLP on description — adds latency and rate budget.
  - API versioning: `X-GitHub-Api-Version: 2022-11-28` header recommended; GitHub deprecates old behaviour with notice.
