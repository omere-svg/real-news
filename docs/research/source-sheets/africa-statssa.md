# South Africa — Stats SA  (SourceId: africa-statssa)

- **Tier:** A  +  primary-official (national statistics office of South Africa, government-authoritative)
- **Role:** STORY (emits RawItem content — press releases, statistical publications, data stories)
- **Endpoint probed:** GET `https://www.statssa.gov.za/index.php?rest_route=/wp/v2/posts&per_page=5&orderby=date&order=desc`
- **Format:** JSON (WordPress REST API v2)
- **Auth:** none  |  **Rate limit:** none documented; Imperva CDN present; `cache-control: max-age=86400`; no `X-RateLimit-*` headers observed; `access-control-allow-origin: *`
- **Probe status:** LIVE-CONFIRMED (HTTP 200; X-WP-Total: 1638 posts; parsed sample below)
- **Region mapping:** asserts Africa | Africa
- **Topic mapping:** `economic-growth` / `inflation` / `industry` → Business; `government-finances` → Politics; `population-characteristics` / `education` / `health` → Science; `crime` / `poverty-and-inequality` → Other; `sustainable-development-goals` → Geopolitics
- **Signals yielded:** no points; comment count derivable via `X-WP-Total` on `/wp/v2/comments?post={id}` but is 0 in practice; no tone/sentiment field
- **externalId (dedup key):** `id` — integer WordPress post ID, e.g. `19628`; stable permalink also usable: `link` = `https://www.statssa.gov.za/?p=19628`
- **Sample response shape:**
  ```json
  {
    "id": 19628,
    "date": "2026-06-17T10:33:23",
    "date_gmt": "2026-06-17T08:33:23",
    "slug": "inflation-rises-to-45-in-may-2026",
    "link": "https://www.statssa.gov.za/?p=19628",
    "title": { "rendered": "Inflation rises to 4,5% in May 2026" },
    "categories": [30, 6, 33],
    "comment_status": "open",
    "type": "post"
  }
  ```
- **Storage/ToS note:** Site disclaimer requires attribution: "acknowledge Stats SA as the source of the basic data wherever they process, apply, utilise, publish or distribute the data." No explicit prohibition on caching; `cache-control: max-age=86400` on API responses. No Creative Commons licence stated; government copyright applies — attribution clause only.
- **Verdict:** TRIAL — adds the only Tier-A Africa primary-official statistical source in the roster; fills the Africa regional bloc with GDP/inflation/trade press releases currently absent from HN/arXiv/GDELT/Knesset/SEC/Wikipedia.
- **Risks:** (1) data.gov.za CKAN portal is DNS-dead as of probe date (June 2026) — the WordPress REST API is the only live programmatic path; (2) no published SLA or rate-limit policy — Imperva CDN could throttle aggressive polling; (3) government WordPress upgrade or URL restructure could silently break `index.php?rest_route=` (non-canonical WP REST path); (4) English-only titles — no multilingual support; (5) no structured `externalId` beyond WordPress integer `id`; mapping to publication reference (P0141, P0441) requires parsing title/content.

---

## Additional note — time-series bulk files

Stats SA also publishes flat-file ZIP archives (Excel + ASCII) at:
`https://www.statssa.gov.za/timeseriesdata/Excel/<dataset-name>.zip`

These are HTTP 200, no-auth, `cache-control: max-age=86400`, last-modified updated on release day. They cover CPI (P0141), GDP (P0441), mining, manufacturing, retail, electricity etc. — 392+ rows per dataset with monthly time series from 2017. This is a SIGNAL source use-case (numeric economic indicators), not a story/item feed, and would require a separate adapter.
