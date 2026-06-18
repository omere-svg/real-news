# data.gov.il (CKAN)  (SourceId: datagovil)

- **Tier:** A — primary-official; Israel's national open data portal, operated by the Israeli government (Prime Minister's Office / Digital Israel directorate), hosting datasets published directly by government ministries and statutory bodies
- **Role:** STORY (emits RawItem content records — each dataset is a structured government data release with title, publisher, timestamps, tags, and downloadable resources; the datastore_search sub-endpoint delivers the actual tabular rows)
- **Endpoint probed:** GET `https://data.gov.il/api/3/action/package_search?rows=3&sort=metadata_modified+desc`
- **Format:** CKAN JSON (standard CKAN 2.x action API; `success: true` wrapper, `result.results[]` array)
- **Auth:** none   |   **Rate limit:** not published; no rate-limit headers observed in probe response; portal appears fully open with no key requirement
- **Probe status:** LIVE-CONFIRMED (HTTP 200 + parsed JSON sample; keyless; 1,193 datasets indexed; datastore_search also confirmed live against resource `e83f763b-b7d7-479e-b172-ae981ddc6de5`, returning 2,183 flight records)
- **Region mapping:** asserts Israel — all datasets are published by Israeli government bodies (ministries, municipalities, statutory authorities); no cross-region content
- **Topic mapping:** native tags (Hebrew free-text) -> must-infer per dataset: budget/finance -> Business; legislation/legal rulings -> Politics; education/health -> Science; flights/infrastructure -> Other; sports -> Sports; no single authoritative category taxonomy, tags are publisher-assigned. A tag-to-Topic mapping layer is required.
- **Signals yielded:** points? NO  |  mentions? NO  |  tone? NO — the portal exposes `num_resources` (integer count of attached files) and `num_tags`, but no views, downloads, ratings, or comment counts. No engagement signals of any kind in the CKAN metadata.
  - Signal JSON paths: `result.results[n].num_resources` (integer), `result.results[n].num_tags` (integer) — structural counts only, not engagement proxies
- **externalId (dedup key):** `result.results[n].id` — UUID assigned by CKAN at dataset creation; stable across updates. Example: `3dfc6b2a-bc1d-4770-8d5f-457ce50a73b3`. Resource-level dedup: `resources[m].id` (separate UUID per file attachment).
- **Sample response shape:**
  ```json
  {
    "id": "3dfc6b2a-bc1d-4770-8d5f-457ce50a73b3",
    "name": "flydata",
    "title": "מאגר טיסות",
    "metadata_modified": "2026-06-17T11:46:12.751799",
    "metadata_created": "2017-08-06T10:53:26.362799",
    "organization": { "name": "airport_authority", "title": "רשות שדות התעופה" },
    "tags": [{ "name": "טיסות", "display_name": "טיסות" }],
    "license_id": "other-open",
    "isopen": true,
    "num_resources": 1,
    "num_tags": 1,
    "resources": [{
      "id": "e83f763b-b7d7-479e-b172-ae981ddc6de5",
      "format": "CSV",
      "datastore_active": true,
      "last_modified": "2026-06-17T11:46:12.721656"
    }]
  }
  ```
- **Storage/ToS note:** datasets carry `license_id: "other-open"` (Hebrew: "אחר (פתוח)") or no license field; the portal is operated under Israel's Government Open Data policy which mandates open reuse with attribution. No explicit CC-BY version was observed in API metadata. Caching is safe for government open data; attribution to the publishing ministry is expected. Some datasets have no license field at all — per-dataset review recommended before redistribution.
- **Verdict:** TRIAL — adds the **Israeli official government data axis**: the only source in the candidate set that emits structured, machine-readable Israeli government records (budgets, legislation, infrastructure, demographics, court rulings, election data) directly from the originating ministries. Existing sources cover Israel only via Knesset parliamentary proceedings; data.gov.il adds the full executive-branch and municipal layer. Downgrade from ADOPT because: (1) titles and tags are Hebrew-only requiring translation, (2) no engagement signals, (3) dataset quality and licensing is inconsistent across publishers, (4) the portal's 1,193 datasets are modest in volume and update cadence varies wildly (some auto-update every 15 min, others are years stale).
- **Risks:** Hebrew-only metadata requires NLP/translation pipeline before topic inference; no SLA or published rate limits (portal could throttle without warning); per-dataset license heterogeneity means ToS compliance requires per-record checks; some datasets reference external CSVs that may move or disappear (url_type: upload vs. external link); CKAN instance is self-hosted by the Israeli government — political decisions could alter API availability or data scope; overlap with existing Knesset source means deduplication logic is needed for legislative datasets that appear on both portals.
