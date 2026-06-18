# Frankfurter / exchangerate.host (FX)  (SourceId: frankfurter-fx)

- **Tier:** B  +  neutral-aggregator (ECB/central-bank data re-served via open API; not the primary issuing authority itself)
- **Role:** SIGNAL (numeric scoring context — FX rates are macro context for stories, not narrative content records)
- **Endpoint probed:** `GET https://api.frankfurter.app/latest`
- **Format:** JSON (also supports CSV via `.csv` suffix and NDJSON via `Accept: application/x-ndjson`)
- **Auth:** none  |  **Rate limit:** no monthly/daily cap; soft throttle to prevent abuse; high-volume users advised to cache or self-host
- **Probe status:** LIVE-CONFIRMED (HTTP 200, parsed full JSON sample — see below)
- **Region mapping:** asserts World (global basket of 30+ currencies covering EUR, USD, ILS, CNY, INR, BRL, etc.) | per-bloc enrichment possible by filtering currency
- **Topic mapping:** FX / macro-economic rates → Business (no native categories; all records are rate data)
- **Signals yielded:** points? NO  |  mentions? NO  |  tone? NO  — purely numeric rate values; no engagement signals
  - `rates.<CURRENCY>` — e.g., `rates.ILS = 3.3761` (EUR-denominated rate for ILS)
- **externalId (dedup key):** composite `base + date`, e.g. `EUR-2026-06-16`; for a pair: `EUR-ILS-2026-06-16`
- **Sample response shape:**
  ```json
  {
    "amount": 1.0,
    "base": "EUR",
    "date": "2026-06-16",
    "rates": {
      "ILS": 3.3761,
      "USD": 1.1594,
      "CNY": 7.8334,
      "GBP": 0.86471,
      "INR": 109.6335
    }
  }
  ```
  Historical time-series (e.g. `GET /2026-06-01..2026-06-16?from=USD&to=EUR,ILS`) returns nested `rates.<date>.<CURRENCY>`.
- **Storage/ToS note:** Free for commercial use. No API-level attribution required; individual data-provider terms (ECB and others) apply to underlying data. ECB rates are public domain. Self-hosting via Docker is recommended for high-volume caching. Cloudflare analytics collected on the hosted version; self-host avoids that.
- **Verdict:** ADOPT  —  adds a **macro FX rate signal layer** absent from all six existing sources (HN/arXiv/GDELT/Knesset/SEC/Wikipedia); enables currency-impact context on Business/Geopolitics stories (e.g. USD/ILS drift alongside Knesset events, CNY moves alongside China geopolitics).
- **Risks:** (1) API is operated by a single maintainer (open-source project); long-term continuity not guaranteed by an institution — self-hosting the Docker image mitigates. (2) ECB only publishes rates on business days (~5 PM CET); weekend gaps expected. (3) 30-currency basket excludes many emerging-market currencies (no SAR, AED, PKR, etc.). (4) No websocket/push; polling at most once per business day is sufficient and appropriate.
