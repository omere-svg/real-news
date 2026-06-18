# CoinGecko  (SourceId: coingecko)

- **Tier:** C  +  engagement — ranks coins by trending search velocity and trading volume, not editorial or institutional authority
- **Role:** SIGNAL (numeric scoring context — trending rank, price change, market cap, volume; no prose news articles)
- **Endpoint probed:** GET https://api.coingecko.com/api/v3/search/trending
- **Format:** JSON
- **Auth:** none (Demo tier, keyless public access) | free-key also available for higher quotas  |   **Rate limit:** Demo = 30 req/min (public/keyless), or 100 req/min with a free Demo API key, 10,000 calls/month cap; paid Basic = 300 req/min, 100 k/month
- **Probe status:** LIVE-CONFIRMED (HTTP 200, full JSON parsed)
- **Region mapping:** must-infer — crypto assets are global by nature; proposed Region: **World**
- **Topic mapping:** cryptocurrency markets -> **Business** (macro financial signal)
- **Signals yielded:**
  - `score` — trending rank (0 = most trending); path: `coins[].item.score`
  - `market_cap_rank` — global market cap ranking; path: `coins[].item.market_cap_rank`
  - `data.price_change_percentage_24h.usd` — 24 h % price change; path: `coins[].item.data.price_change_percentage_24h.usd`
  - `data.total_volume` — 24 h USD trading volume (string, e.g. "$924,136,531"); path: `coins[].item.data.total_volume`
  - `data.market_cap` — current market cap USD string; path: `coins[].item.data.market_cap`
  - No native comment counts or sentiment fields; volume + price change serve as engagement proxies
- **externalId (dedup key):** `coins[].item.id` (string slug, e.g. `"uniswap"`, stable across calls); `coin_id` (integer, e.g. `12504`) is an alternative stable numeric key
- **Sample response shape:**
  ```json
  {
    "coins": [{
      "item": {
        "id": "uniswap",
        "coin_id": 12504,
        "name": "Uniswap",
        "symbol": "UNI",
        "market_cap_rank": 44,
        "slug": "uniswap",
        "score": 0,
        "data": {
          "price": 3.327,
          "price_change_percentage_24h": { "usd": 10.74 },
          "market_cap": "$2,068,694,138",
          "total_volume": "$924,136,531"
        }
      }
    }],
    "nfts": [...],
    "categories": [...]
  }
  ```
- **Storage/ToS note:** Demo tier requires attribution — must display "Data provided by CoinGecko" with hyperlink to their API page. Cache/update frequency is every 10 minutes per CoinGecko docs; local caching at that granularity is consistent with their model. Commercial redistribution requires a paid plan. No scraping; this is the official public REST API.
- **Verdict:** ADOPT — adds **real-time crypto market pulse** (trending coins by search velocity + price momentum) as a pure financial-signal axis; none of the existing 6 sources (HN/arXiv/GDELT/Knesset/SEC EDGAR/Wikipedia) cover crypto asset markets or DeFi activity
- **Risks:**
  - Demo keyless tier is 30 req/min and 10 k calls/month — sufficient for a polling cadence of ~every 10 min (144/day, ~4,320/month for one endpoint), but leaves little headroom if multiple endpoints are added.
  - Attribution clause on Demo tier must be surfaced in any UI or downstream output.
  - No tone/sentiment field natively; all signal is price/volume/rank — requires derived computation for sentiment context.
  - Crypto market data is inherently volatile and noisy; signals may generate false positives as macro-news indicators.
  - API versioning: v3 is stable and documented; v3 has been the production version since 2019 with no announced deprecation.
