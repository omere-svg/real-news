# Stack Exchange API  (SourceId: stackexchange)

- **Tier:** C  +  engagement — scores, view counts, and answer counts are community-voting/activity signals rather than authoritative institutional or editorial data
- **Role:** BOTH — emits RawItem content records (question title, tags, link, creation date) AND supplies numeric engagement signals (score = upvotes minus downvotes, view_count, answer_count)
- **Endpoint probed:** GET https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&site=stackoverflow&pagesize=3&filter=default
- **Format:** JSON
- **Auth:** none (unauthenticated works; free registered app key raises quota from 300 to 10,000 req/day)  |  **Rate limit:** 300 requests/day anonymous (confirmed via `quota_max: 300` in response); ~10,000/day with a registered free key; per-second throttle applies if requests come too fast (API returns `backoff` field with seconds to wait). Pacing: one poll per topic window per site per hour; respect `backoff` field in every response.
- **Probe status:** LIVE-CONFIRMED — HTTP 200, parsed JSON, `quota_max: 300`, `quota_remaining: 299`, full item array with score/view/answer fields returned
- **Region mapping:** must-infer — questions carry no native geo tag; propose World (global developer/science community); site parameter can narrow to e.g. `ai.stackexchange` for AI domain
- **Topic mapping:** `tags[]` array per question (e.g. `["machine-learning","neural-network","llm"]`) -> AI / Science / Other; cross-site routing: `ai.stackexchange` -> AI, `physics.stackexchange` -> Science, `economics.stackexchange` -> Business, `politics.stackexchange` -> Politics; must-infer for borderline tags
- **Signals yielded:**
  - points (community score): `items[*].score` (net upvotes, e.g. 27536)
  - mentions (views as reach): `items[*].view_count` (e.g. 1986533)
  - activity proxy (answers): `items[*].answer_count` (e.g. 26)
  - accepted answer flag: `items[*].accepted_answer_id` (bool presence)
  - no native tone/sentiment field
- **externalId (dedup key):** `items[*].question_id` — stable numeric integer, e.g. `11227809`; secondary: `items[*].link` e.g. `"https://stackoverflow.com/questions/11227809/..."`
- **Sample response shape:**
  ```json
  {
    "question_id": 11227809,
    "title": "Why is conditional processing of a sorted array faster than of an unsorted array?",
    "tags": ["java","c++","performance","cpu-architecture","branch-prediction"],
    "score": 27536,
    "view_count": 1986533,
    "answer_count": 26,
    "accepted_answer_id": 11227902,
    "is_answered": true,
    "creation_date": 1340805096,
    "last_activity_date": 1775626532,
    "content_license": "CC BY-SA 4.0",
    "link": "https://stackoverflow.com/questions/11227809/...",
    "owner": { "user_id": 87234, "display_name": "GManNickG", "reputation": 507077 }
  }
  ```
- **Storage/ToS note:** All Stack Exchange content is licensed under CC BY-SA 4.0 (confirmed via `content_license` field on every item). Caching is permitted; attribution to Stack Exchange/Stack Overflow with link-back is required per the license. The API is a public, official offering by Stack Overflow Inc. (Prosus). No prohibition on storing API responses for aggregation; bulk data dumps are separately available under the same CC BY-SA terms. Commercial use is permitted with attribution.
- **Verdict:** TRIAL — adds a **developer/science community demand signal** (questions + vote scores as a proxy for what technical practitioners find important right now) absent from all six existing sources. HN covers some overlap but is editorial/link-sharing; arXiv is formal papers only; neither surfaces practitioner confusion, active technical debate, or emerging tool adoption with the precision of tagged Q&A vote counts. The `tags[]` array enables zero-shot AI/Science topic routing, and multi-site capability lets a single adapter cover AI, physics, economics, and politics sub-communities.
- **Risks:**
  - Rate cap: 300 req/day anonymous is very low for production polling across multiple sites; a free registered key (no cost, no OAuth) raises this to ~10,000/day — must register an app key before production use.
  - `backoff` field in responses must be honored; ignoring it triggers hard throttling.
  - Score ≠ recency: top-voted questions are often years old; must combine `sort=creation` or `sort=activity` with `fromdate` parameter to get fresh signal rather than all-time hall-of-fame.
  - Signal noise: highly-voted questions reflect evergreen curiosity (git, sorting) not breaking news; best used as a trend/demand signal over rolling windows, not a current-events source.
  - No native geo tagging: region inference requires NLP on tags/title or hardcoded site-to-region mapping.
  - CC BY-SA is a share-alike license: if Project Horizon surfaces derived content, downstream license obligations may apply; legal review recommended for aggregated display.
