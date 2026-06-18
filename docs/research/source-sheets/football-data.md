# football-data.org  (SourceId: football-data)

- **Tier:** C  +  engagement/sports-stats aggregator (commercial third-party sports data vendor, not an official governing body)
- **Role:** STORY (emits RawItem content — match fixtures, results, standings per competition)
- **Endpoint probed:** GET https://api.football-data.org/v4/competitions/
- **Format:** JSON
- **Auth:** free-key (header `X-Auth-Token`; unauthenticated requests also return HTTP 200 for /competitions but with reduced scope)   |   **Rate limit:** free tier 10 req/min, paid plans up to 120 req/min; `X-RequestCounter-Reset` header signals quota renewal
- **Probe status:** LIVE-CONFIRMED (HTTP 200, parsed 185-competition JSON array without an auth key)
- **Region mapping:** asserts World (covers 150+ competitions across Europe, Americas, Asia, Africa, Oceania)
- **Topic mapping:** native type LEAGUE / CUP / PLAYOFFS -> our Topic: Sports
- **Signals yielded:** points? YES — `standings[].table[].points` (integer league-table points per team); mentions? NO; tone? NO
  - Points path: `GET /v4/competitions/{code}/standings` -> `.standings[0].table[n].points`
  - Other numeric fields: `playedGames`, `won`, `draw`, `lost`, `goalsFor`, `goalsAgainst`, `goalDifference`, `position`
  - No engagement metrics (likes, views, comment counts) exist in the API
- **externalId (dedup key):** `id` (integer, e.g. `2021` for Premier League; `id` is stable across seasons)
- **Sample response shape** (from live /v4/competitions/ probe):
  ```json
  {
    "count": 185,
    "competitions": [
      {
        "id": 2021,
        "area": { "id": 2072, "name": "England", "code": "ENG" },
        "name": "Premier League",
        "code": "PL",
        "type": "LEAGUE",
        "plan": "TIER_ONE",
        "currentSeason": {
          "id": 2403,
          "startDate": "2025-08-15",
          "endDate": "2026-05-24",
          "currentMatchday": 38,
          "winner": null
        },
        "lastUpdated": "2024-09-13T16:51:24Z"
      }
    ]
  }
  ```
- **Storage/ToS note:** No explicit caching policy found in public docs. The site encourages "smart requests" and avoiding excessive polling. Attribution to football-data.org is expected. Free tier is available with registration (API key); commercial redistribution of raw data would likely require a paid plan. Custom/enterprise inquiries via daniel@football-data.org.
- **Verdict:** PARK — adds a pure Sports vertical (fixture/results/standings) not covered by any of HN/arXiv/GDELT/Knesset/SEC/Wikipedia, but the Topic (Sports) is orthogonal to Project Horizon's news/intelligence focus on geopolitics, policy, and markets; sports results are low-signal for an objective news aggregator unless Sports is a planned topic bloc.
- **Risks:** (1) commercial vendor with paid tiers — free tier rate-limited to 10 req/min and free competitions may shrink; (2) API key required for meaningful access beyond competition list; (3) no scraping allowed — must use official API; (4) data is sports-only with no geopolitical or market relevance; (5) contract stability risk: single-person operation (daniel@football-data.org) with no SLA guarantee.
