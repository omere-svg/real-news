# The Guardian Open Platform  (SourceId: guardian)

- **Tier:** D  +  editorial — content is produced by a named news organisation with an editorial stance; quality-controlled and fact-checked but not primary-official or neutral aggregator
- **Role:** STORY — emits RawItem content records (headline, body, byline, section, publication date, URL) with rich structured metadata; does NOT emit numeric engagement/popularity signals
- **Endpoint probed:** GET https://content.guardianapis.com/search?api-key=test&show-fields=all&show-tags=tone,keyword&page-size=1&section=world
- **Format:** JSON
- **Auth:** free-key (register at https://bonobo.capi.gutools.co.uk/register/developer; the literal key `test` works for low-volume developer probing)  |  **Rate limit:** developer tier: 12 requests/second, 5,000 requests/day (documented on the platform access page; not live-confirmed in this session due to `open-platform.theguardian.com` being unreachable, but widely cited in third-party references)
- **Probe status:** LIVE-CONFIRMED — GET with `api-key=test` returned HTTP 200, `response.status: "ok"`, `userTier: "developer"`, parsed 2,666,401 total indexed articles; sample response verified below
- **Region mapping:** must-infer — articles have no explicit geo coordinate or country field; region must be derived from `sectionId` (e.g., `us-news` -> US, `australia-news` -> Oceania, `world` -> World, `middle-east` -> MiddleEast, `uk-news` -> EU), keyword tags (e.g., tag id `world/iran` -> MiddleEast), or NLP on headline/body at ingest time
- **Topic mapping:** `sectionId` -> our Topic:
  - `technology` -> AI / Science
  - `politics`, `us-news`, `uk-news` -> Politics
  - `world` -> Geopolitics
  - `business` -> Business
  - `science` -> Science
  - `sport` -> Sports
  - `environment`, `society`, `education` -> Other
  - Tone tags (e.g. `tone/news`, `tone/analysis`, `tone/letters`, `tone/minutebyminute`) provide article-type classification, not topic
- **Signals yielded:**
  - points: NO native popularity/upvote field
  - mentions: NO comment count field in the API response (Guardian comments are on-site only, not exposed via CAPI)
  - tone: YES — `response.results[*].tags` contains tags with `type: "tone"` (e.g. `"tone/news"`, `"tone/analysis"`, `"tone/feature"`, `"tone/comment"`) at path `results[*].tags[?(@.type=='tone')].webTitle`; this is editorial tone classification, not sentiment score
- **externalId (dedup key):** `response.results[*].id` — stable path-based slug, e.g. `"technology/2026/may/10/mistaking-ai-behaviour-for-conscious-being"`; format is `section/year/month/day/slug`; globally unique and stable after publication
- **Sample response shape** (live-confirmed):
  ```json
  {
    "response": {
      "status": "ok",
      "userTier": "developer",
      "total": 2666401,
      "results": [{
        "id": "technology/2026/may/10/mistaking-ai-behaviour-for-conscious-being",
        "type": "article",
        "sectionId": "technology",
        "webPublicationDate": "2026-05-10T06:00:10Z",
        "webTitle": "Mistaking AI behaviour for a conscious being",
        "fields": {
          "headline": "Mistaking AI behaviour for a conscious being",
          "byline": "Letters",
          "wordcount": "300",
          "bodyText": "...",
          "firstPublicationDate": "2026-05-10T06:00:10Z"
        },
        "tags": [
          { "id": "tone/letters", "type": "tone", "webTitle": "Letters" }
        ],
        "pillarId": "pillar/news",
        "pillarName": "News"
      }]
    }
  }
  ```
- **Storage/ToS note:** The Guardian Open Platform Terms (linked from registration page) permit non-commercial applications to cache and display content provided that (1) attribution "Powered by the Guardian" is displayed, (2) content links back to the original Guardian URL, (3) full article body is not republished without a commercial licence — the `bodyText`/`body` fields are available in the API but republishing them wholesale likely requires the paid "commercial" tier. For Project Horizon's internal intelligence aggregation (store headline + URL + metadata, link out), the developer tier is appropriate; bulk body-text storage for LLM training would require a commercial agreement. The `test` key is intended for development only; production use requires a registered key.
- **Verdict:** ADOPT — adds **high-quality English-language editorial journalism with structured section/topic/tone taxonomy** not present in any of the current 6 sources (HN surfaces tech links without body text; arXiv is preprints only; GDELT is event signals without article bodies; Knesset is legislative; SEC is financial filings; Wikipedia is encyclopaedic). Guardian is the only source offering parsed full-text news articles with byline, editorial tone classification, and a stable path-based dedup key across Politics, Geopolitics, Science, Business, and Sports.
- **Risks:**
  - **Rate cap:** 5,000 requests/day on the free developer key is tight for continuous polling across 80 sections; a production deployment should register a dedicated key and consider the paid tier for higher limits.
  - **Body text licensing:** storing `body`/`bodyText` at scale without a commercial licence is a ToS grey zone; safe approach is to store metadata + headline only and fetch body on demand.
  - **Editorial bias:** The Guardian has a documented left-of-centre editorial stance (UK-origin); stories on Politics and Geopolitics carry inherent framing; requires pairing with sources of different editorial orientation for objectivity claims.
  - **`test` key instability:** the `test` key appears to be a publicly documented developer convenience key, not a private credential; it may be rate-limited, revoked, or restricted without notice. A registered key should be obtained before production use.
  - **No engagement signals:** unlike HN (points) or Reddit (score/comments), the Guardian CAPI exposes no reader engagement metrics, making it a pure STORY source with no signal enrichment capability.
  - **Geo inference required:** section-to-region mapping must be maintained manually as Guardian adds or reorganises sections; a mis-mapping (e.g. `world` section covering stories from multiple blocs) could dilute per-bloc region accuracy.
