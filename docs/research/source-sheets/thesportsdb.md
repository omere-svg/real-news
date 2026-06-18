# TheSportsDB  (SourceId: thesportsdb)

- **Tier:** C  +  engagement — community-maintained sports results aggregator; not an official league/federation data provider
- **Role:** STORY (emits RawItem content — one record per match/event with scores, teams, league, venue, timestamp)
- **Endpoint probed:** GET https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=2024-01-15&s=Soccer
- **Format:** JSON
- **Auth:** none (free tier uses hardcoded key `3` in URL path; no signup required)  |  **Rate limit:** 30 req/min free; 100 req/min premium ($9/mo); 429 on breach, retry after 1 min
- **Probe status:** LIVE-CONFIRMED (HTTP 200, valid JSON array of event objects parsed successfully)
- **Region mapping:** must-infer — `strCountry` and `strLeague` fields give country/league context but the API is global; proposed per-bloc Region: **World**
- **Topic mapping:** `strSport` (Soccer, Basketball, etc.) -> **Sports** (direct mapping)
- **Signals yielded:** no points field; no mention counts; no tone/sentiment.  `intHomeScore` / `intAwayScore` are match scores (not engagement metrics). `intSpectators` exists but is almost always null. `intScoreVotes` exists but is always null in free tier. No engagement signals.
- **externalId (dedup key):** `idEvent` — example: `"1817618"` (stable numeric string, globally unique per match)
- **Sample response shape:**
  ```json
  {
    "idEvent":      "1817618",
    "strEvent":     "South Korea vs Bahrain",
    "strSport":     "Soccer",
    "strLeague":    "AFC Asian Cup",
    "strSeason":    "2023",
    "dateEvent":    "2024-01-15",
    "strTime":      "11:30:00",
    "strTimestamp": "2024-01-15T11:30:00",
    "strHomeTeam":  "South Korea",
    "strAwayTeam":  "Bahrain",
    "intHomeScore": "3",
    "intAwayScore": "1",
    "strStatus":    "FT",
    "strVenue":     "Jassim Bin Hamad Stadium",
    "strCountry":   "Qatar",
    "strVideo":     "https://www.youtube.com/watch?v=ukv8FjjVS6Y"
  }
  ```
- **Storage/ToS note:** ToS explicitly states "You can scrape, copy and modify any content returned from the API, as long as you use the official end points." Caching is therefore permitted. Attribution required when using custom artwork; standard data use does not mandate attribution text but linking back "where appropriate" is encouraged. No app-store publication without paid tier. Reselling prohibited.
- **Verdict:** TRIAL — adds the **Sports** topic axis (live match results, scores, leagues, global sports events) which none of the existing 6 sources (HN/arXiv/GDELT/Knesset/SEC/Wikipedia) cover at all; however zero engagement signals means it contributes STORY records only with no scoring weight.
- **Risks:** Community-maintained database — data completeness and accuracy vary by sport/league; free key (`3`) is a demo key that may be rate-capped more aggressively than documented; no SLA; premium tier required for livescores and full method access; `intSpectators` and `intScoreVotes` are effectively always null on free tier, limiting signal richness.
