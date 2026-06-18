# Reserve Bank of India  (SourceId: india-rbi)

- **Tier:** A — primary-official; the RBI is India's central bank and sole issuer of monetary policy and banking regulation.
- **Role:** STORY (emits RawItem content — press releases, monetary policy decisions, auction results, regulatory notifications)
- **Endpoint probed:** GET https://rbi.org.in/pressreleases_rss.xml
- **Format:** RSS 2.0 (XML), `text/xml`, no JSON API publicly documented
- **Auth:** none   |   **Rate limit:** none documented; feed is publicly accessible without key; pacing to ~1 req/min recommended out of courtesy
- **Probe status:** LIVE-CONFIRMED — HTTP 200, `text/xml`, 96 KB payload, 10 items parsed successfully on 2026-06-17
- **Region mapping:** asserts India | proposed per-bloc Region: India
- **Topic mapping:** monetary-policy/banking-regulation → Business; rate decisions → Business; occasional macro/stability → Business/Geopolitics | all inferred
- **Signals yielded:** points? NO — no vote/upvote field. mentions? NO — no comment count. tone? NO — no sentiment field. (Pure official text; tone must be computed externally)
- **externalId (dedup key):** `prid` query parameter extracted from `<link>` URL — e.g. `prid=62954` (monotonically increasing integer, unique per press release)
- **Sample response shape:**
  ```xml
  <channel>
    <title>PRESS RELEASES FROM RBI</title>
    <copyright>Copyright Reserve Bank of India. All Rights Reserved.</copyright>
    <item>
      <title>91-Day, 182-Day and 364-Day T-Bill Auction Result: Cut-off</title>
      <link>https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=62952</link>
      <pubDate>Wed, 17 Jun 2026 13:15:00</pubDate>
      <description><![CDATA[...HTML table with auction data...]]></description>
    </item>
    <!-- 9 more items, rolling window of latest 10 releases -->
  </channel>
  ```
- **Storage/ToS note:** RBI Disclaimer prohibits *caching and framing of the website*. However this applies to HTML pages/framing; RSS feeds are explicitly designed for syndication. Linking to pages other than the homepage requires prior written permission — avoid deep-linking individual press release URLs as primary permalinks without attribution. Safe practice: store the raw XML content with attribution "Source: Reserve Bank of India (rbi.org.in)" and do not republish full HTML bodies verbatim. The feed copyright line reads: "Copyright Reserve Bank of India. All Rights Reserved."
- **Verdict:** TRIAL — adds the only **India central-bank monetary signal** axis (repo rate decisions, T-bill/G-sec auction results, banking regulation notices) absent from all six existing sources (HN/arXiv/GDELT/Knesset/SEC/Wikipedia). Critical for India macro coverage.
- **Risks:** (1) RSS feed limited to 10 most recent items — high-frequency publish days (auction days) may skip items if polling interval exceeds ~2 hours; no paginated history or bulk download API is publicly available. (2) The DBIE data portal (dbie.rbi.org.in) returns HTTP 418 with "Unauthorised Access" for programmatic calls, suggesting IP-based blocking or bot-detection — structured time-series data (rates, FX reserves) is not accessible without registration. (3) RBI disclaimer language is ambiguous about RSS caching rights; formal ToS clarification recommended before production use. (4) No stable REST/JSON API; any future site migration could break the XML feed URL without notice. (5) Content is entirely in English but describes India-domestic regulatory actions — narrow geopolitical scope.
