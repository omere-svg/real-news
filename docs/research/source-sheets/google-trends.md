# Google Trends  (SourceId: google-trends)

- **Tier:** C  +  engagement (reflects public search curiosity volume, not authoritative/editorial)
- **Role:** SIGNAL (numeric search-volume context — `ht:approx_traffic` annotates story salience)
- **Endpoint probed:** GET https://trends.google.com/trending/rss?geo=US
- **Format:** RSS/XML (Atom-extended with `ht:` namespace fields)
- **Auth:** none  |  **Rate limit:** undocumented; cache-control headers return `no-store, max-age=0` — Google actively prevents caching; pacing: ~1 req/min conservative to avoid 429/block
- **Probe status:** LIVE-CONFIRMED (HTTP 200, parsed 10 trending items with `ht:approx_traffic` and linked news items; confirmed geo=IL also returns 200 with Hebrew-language results)
- **Region mapping:** asserts per `geo=` param (US, IL, and ~220 others) | proposed: World (can serve all blocs; specific runs scoped to Israel + US as primary)
- **Topic mapping:** no native category in RSS — must-infer from `<title>` text against our Topic set (AI/Geopolitics/Politics/Sports/Business/Science/Other); linked `ht:news_item` headlines can support LLM-based classification
- **Signals yielded:** points YES (`ht:approx_traffic` — bucketed string e.g. `"2000+"`, `"1000+"`); mentions NO (count not provided); tone NO (no sentiment field)
  - `item/ht:approx_traffic` — search-volume bucket (string, not integer)
  - `item/pubDate` — ISO datetime of when trend was recorded
  - `item/ht:news_item/ht:news_item_url` — associated news article URL
- **externalId (dedup key):** composite of `<title>` (normalised lowercase) + `pubDate` date component, e.g. `flights::2026-06-17`; no stable opaque ID is emitted — slug must be synthesised
- **Sample response shape:**
  ```xml
  <item>
    <title>trump cancels dni hearings</title>
    <ht:approx_traffic>1000+</ht:approx_traffic>
    <pubDate>Wed, 17 Jun 2026 04:40:00 -0700</pubDate>
    <ht:news_item>
      <ht:news_item_title>Trump says he is canceling DNI hearings …</ht:news_item_title>
      <ht:news_item_url>https://www.cnn.com/2026/06/17/politics/…</ht:news_item_url>
      <ht:news_item_source>CNN</ht:news_item_source>
    </ht:news_item>
  </item>
  ```
- **Storage/ToS note:** RISK. Google's API Developer Terms explicitly prohibit "permanent copies" and caching beyond cache-header expiry. The RSS endpoint itself sets `Cache-Control: no-cache, no-store, max-age=0` — Google's stated policy is zero caching. The RSS feed at `/trending/rss` is NOT listed in `trends.google.com/robots.txt` Disallow rules (only `/explore?` and `/trends/explore?` are blocked there), but `www.google.com/robots.txt` does disallow `/trends/api`. The feed is therefore in a legal grey zone: publicly accessible without auth, but storing results would violate API Developer Terms if treated as an "API". No official terms specifically address the RSS feed. Attribution to "Google Trends" required.
- **Verdict:** TRIAL — **new axis: real-time public search-demand signal** that none of HN/arXiv/GDELT/Knesset/SEC/Wikipedia provide; it reveals what topics ordinary people are actively searching at an hourly cadence, enabling demand-weighted story scoring rather than supply-weighted editorial frequency.
- **Risks:**
  - **Contract instability (HIGH):** No official public API exists. The `/trending/rss` endpoint is undocumented and Google has broken, gated, or retired unofficial Trends endpoints repeatedly (the `/trends/api/` path now returns 404; the `dailytrends` JSON endpoint is gone). Google is currently running an alpha closed API at developers.google.com/search/apis/trends — when/if that launches publicly it may replace or block the RSS.
  - **ToS storage risk (HIGH):** Caching violates API Developer Terms if the RSS is treated as an API. Storing even one row in the database may constitute a "permanent copy" contrary to Terms.
  - **No stable externalId (MEDIUM):** Must synthesise a dedup key; if Google changes pubDate granularity or title formatting, duplicates will appear.
  - **Traffic buckets not integers (LOW-MEDIUM):** `ht:approx_traffic` returns strings like `"200+"` — requires parsing and lossy integer coercion, making trend comparison imprecise.
  - **Geo coverage uneven (LOW):** IL geo confirmed working; some smaller geos return fewer items or empty feeds.
