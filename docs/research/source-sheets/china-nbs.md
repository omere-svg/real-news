# National Bureau of Statistics of China  (SourceId: china-nbs)

- **Tier:** A — primary-official (government statistics bureau, direct primary source for Chinese macro data)
- **Role:** SIGNAL (numeric scoring context — emits time-series economic/demographic indicators, not narrative content records)
- **Endpoint probed:** `GET https://data.stats.gov.cn/english/easyquery.htm?m=QueryData&dbcode=hgnd&rowcode=zb&colcode=sj&wds=%5B%5D&dfwds=%5B%7B%22wdcode%22%3A%22sj%22%2C%22valuecode%22%3A%222023%22%7D%5D&k1=1718000000000`
- **Format:** JSON (reverse-engineered; not officially documented)
- **Auth:** none (no API key required)   |   **Rate limit:** undocumented; WAF enforced, pacing unknown
- **Probe status:** FAILED — HTTP 403 with WAF reason `UrlACL`; server at `121.32.243.92` is reachable (TLS handshake succeeds) but returns `Client IP: 84.108.111.155 / reason:UrlACL` for all `/english/easyquery.htm` calls from non-Chinese IPs
- **Region mapping:** asserts China | proposed per-bloc Region: China
- **Topic mapping:** economic/demographic indicators -> Business, Science; must-infer for topic tagging (no native category field in API responses)
- **Signals yielded:** no points, no mentions, no tone — the API returns time-series numeric data only (`strdata` field); there are no engagement or sentiment fields
- **externalId (dedup key):** composite of `dbcode` + `wds[].valuecode` + period code (e.g. `hgnd|A090201|2023`); no single `id` field
- **Sample response shape** (from community reverse-engineering, not a live probe):
  ```json
  {
    "returndata": {
      "datanodes": [
        {
          "code": "A090201_zb_2023_A",
          "wds": [{"wdcode":"zb","valuecode":"A090201"}, {"wdcode":"sj","valuecode":"2023"}],
          "data": {"strdata":"1260582","hasdata":true,"dotcount":0}
        }
      ],
      "wdnodes": [
        {"wdcode":"zb","nodes":[{"code":"A090201","cname":"GDP","unit":"亿元"}]}
      ]
    }
  }
  ```
- **Storage/ToS note:** ToS (stats.gov.cn/english/nbs/200701/t20070104_59236.html) permits reuse for news/public-information purposes with attribution "Source: National Bureau of Statistics" and `www.stats.gov.cn`. Caching allowed under reasonable-and-good-faith terms. Distorting data meaning is prohibited. No explicit machine-ingestion clause.
- **Verdict:** PARK — the data API at `data.stats.gov.cn` is geo-blocked from outside China via WAF IP ACL; there is no official developer API documentation and the endpoint is reverse-engineered only. The NEW axis it would add: **authoritative Chinese macro-economic time-series context** (GDP, CPI, trade, population) unavailable from any existing source (HN/arXiv/GDELT/Knesset/SEC/Wikipedia), but the geo-restriction makes reliable ingestion from a non-CN hosted service impossible without a China-resident relay or third-party mirror.
- **Risks:**
  - Geo-restriction: WAF blocks all non-Chinese IP ranges at the data API layer; confirmed HTTP 403 with `reason:UrlACL`
  - Endpoint instability: NBS renames API endpoints without notice (at least 3 changes documented 2026-05 to 2026-06: `easyquery.htm` → `external/getEsDataByCidAndDt` → `external/stream/esData`)
  - No official API contract: entirely reverse-engineered; breaking changes have no notice period
  - ToS ambiguity: terms permit "news/public information" reuse with attribution but do not explicitly authorize automated bulk ingestion or commercial use
  - Political sensitivity: Chinese government source; data revisions or indicator definitions may change without announcement
