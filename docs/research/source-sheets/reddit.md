# Reddit (subreddit top/hot JSON)  (SourceId: reddit)

- **Tier:** C  +  engagement — upvote scores and comment counts are community-voting signals; no editorial fact-checking or institutional authority; content quality varies widely by subreddit
- **Role:** BOTH — emits RawItem content records (title, url, author, selftext, subreddit, created_utc) AND supplies numeric engagement signals (score = points proxy, num_comments = mentions proxy)
- **Endpoint probed:** GET https://www.reddit.com/r/worldnews/top.json?limit=2&t=day  (unauthenticated, User-Agent: ProjectHorizon/1.0 by /u/test)
- **Format:** JSON
- **Auth:** free-key (OAuth2 required — client_id + client_secret from free app registration at reddit.com/prefs/apps; bearer token obtained via client_credentials or script flow)  |  **Rate limit:** 60 requests/minute per OAuth2 token (monitored via X-Ratelimit-Used / X-Ratelimit-Remaining / X-Ratelimit-Reset response headers); unauthenticated requests now return HTTP 403
- **Probe status:** DOCS-ONLY — live GET returned HTTP 403 on all attempted variants (www.reddit.com, old.reddit.com, oauth.reddit.com); unauthenticated access to .json endpoints was removed post-2023 API policy change. OAuth2 bearer token required; none available in this environment.
- **Region mapping:** must-infer — posts have no geo tag; subreddit name is the only region hint (r/israel -> Israel, r/worldnews -> World, r/MachineLearning -> World/US); propose per-subreddit mapping at ingest config time
- **Topic mapping:** subreddit name -> our Topic (r/worldnews -> Geopolitics, r/israel -> Geopolitics/Politics, r/MachineLearning -> AI, r/science -> Science, r/business -> Business); must-infer for cross-topic subreddits via title NLP
- **Signals yielded:**
  - points (upvote score): `data.children[*].data.score` (integer, e.g. 42871)
  - mentions (comment volume): `data.children[*].data.num_comments` (integer, e.g. 3204)
  - no native tone/sentiment field; upvote_ratio (0.0–1.0) is a weak positivity proxy: `data.children[*].data.upvote_ratio`
- **externalId (dedup key):** `data.children[*].data.id` — stable base-36 post id, e.g. `"1dlyc57"`; full canonical form: `data.children[*].data.name` e.g. `"t3_1dlyc57"`
- **Sample response shape** (from Reddit API documentation and PRAW library reference; not live-confirmed):
  ```json
  {
    "data": {
      "children": [{
        "data": {
          "id": "1dlyc57",
          "name": "t3_1dlyc57",
          "title": "Israel strikes Hezbollah command center in Beirut",
          "url": "https://www.bbc.com/news/world-middle-east-...",
          "author": "u/some_user",
          "subreddit": "worldnews",
          "score": 42871,
          "num_comments": 3204,
          "upvote_ratio": 0.93,
          "created_utc": 1750158000,
          "selftext": "",
          "permalink": "/r/worldnews/comments/1dlyc57/..."
        }
      }],
      "after": "t3_xyz123"
    }
  }
  ```
- **Storage/ToS note:** Reddit's 2023 Data API Terms (redditinc.com/policies/data-api-terms) impose significant restrictions: (1) data may not be used to train AI/ML models without a separate commercial license; (2) caching permitted only for short operational periods, not bulk archival; (3) content must link back to the original Reddit post; (4) commercial uses beyond a specified free request quota require a paid API tier. The free tier is intended for non-commercial apps and personal bots; a "large-scale data" or AI-training use case requires a negotiated commercial agreement. Republishing post titles and URLs (not body text) for aggregation/linking is the safest interpretation of permitted use.
- **Verdict:** PARK — adds a **real-time crowd-sourced viral story signal** (what the English-speaking internet considers important right now) not present in HN/arXiv/GDELT/Knesset/SEC/Wikipedia. However, the post-2023 ToS explicitly restricts AI/ML use and bulk data storage, which conflicts with Project Horizon's ingestion pipeline. The free OAuth tier is technically feasible but legally marginal for a news-intelligence product. Revisit if Reddit launches a formal media/research API tier with clearer data rights.
- **Risks:**
  - **ToS instability:** Reddit's API terms changed abruptly in 2023 and explicitly restrict AI/ML training and bulk caching; Project Horizon's use case (store, score, surface) sits in a legally grey zone without a commercial agreement.
  - **Rate cap:** 60 req/min per OAuth token; polling 5+ subreddits at useful frequency requires careful pacing or multiple registered apps.
  - **Auth complexity:** requires a registered Reddit account + app registration; tokens expire every 1 hour and must be refreshed via client_credentials flow — adds operational overhead.
  - **Signal quality:** upvote scores are gameable and subject to vote-fuzzing (Reddit deliberately obscures exact counts); not suitable as a precision numeric signal.
  - **Content noise:** r/worldnews and r/israel include high volumes of opinion, satire, and unverified claims — requires aggressive source-URL filtering or title-level NLP quality gate before use as a STORY source.
  - **No geo coordinates:** region inference is entirely dependent on subreddit-name config; cross-posted stories appear in multiple subreddits, causing dedup challenges without canonical URL normalization.
