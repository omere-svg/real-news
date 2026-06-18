# UAE — Bayanat / Open Data Portal  (SourceId: me-uae-bayanat)

- **Tier:** A — primary-official UAE federal government open data portal, operated by the Federal Competitiveness and Statistics Centre (FCSC), publishing data from across all UAE ministries and emirate authorities
- **Role:** SIGNAL (numeric scoring context — official government statistical datasets: demographics, economics, health, labour, housing, energy; no article-style content records)
- **Endpoint probed:** `GET https://bayanat.ae/api/DatasetResources/GetDatasetResource?resourceID=f09aa3e3-7296-474f-b48c-40e6ccf7d86c`
- **Format:** JSON (custom REST wrapper over CKAN 2.9.5 backend; also supports CKAN standard `/api/3/action/` routes)
- **Auth:** none (documented examples show plain GET requests without any API key or Authorization header)   |   **Rate limit:** not documented; portal runs behind Cloudflare WAF — undisclosed throttle; no `X-RateLimit-*` headers described
- **Probe status:** FAILED — all connection attempts timed out (exit code 28) from a non-UAE IP address. Both `bayanat.ae` and `admin.bayanat.ae` endpoints timed out at the TCP level (IP 79.98.126.26 did not complete TLS handshake). `opendata.fcsc.gov.ae` (the related FCSC CKAN portal) returned Cloudflare 403. Consistent with Cloudflare geo-IP or IP-reputation blocking of non-UAE/non-GCC egress IPs.
- **Region mapping:** asserts MiddleEast | datasets explicitly tagged by UAE emirate (Abu Dhabi, Dubai, Sharjah, etc.) and by UAE federal entity; per-bloc mapping: MiddleEast
- **Topic mapping:** Government Statistics → Business/Science; Demographics → Science; Economic → Business; Health → Science; Housing → Business; Labour/Employment → Business; Environment/Energy → Science; Public Safety → Other; Tourism → Business
- **Signals yielded:** points? NO   mentions? NO   tone? NO — datasets are tabular statistical records; the `GetDatasetResource` API returns rows of figures with no engagement or popularity metadata. No download-count, rating, or sentiment field is exposed via the public API.
- **externalId (dedup key):** `resourceID` (URL-safe Base64 GUID assigned by the portal) — example: `f09aa3e3-7296-474f-b48c-40e6ccf7d86c`  
  Dataset-level dedup: `id` field from CKAN `package_show` action (URL-safe Base64 string, e.g. `banWyflmQNzwkVY4_P5vxAG1fGesVSuXN4VdMU-CZCI`)
- **Sample response shape** (from developer docs — not live-confirmed):
  ```json
  {
    "result": {
      "resourceID": "f09aa3e3-7296-474f-b48c-40e6ccf7d86c",
      "title": "Net Operating Balance at UAE Level Quarterly",
      "records": [
        { "Year": "2023", "Quarter": "Q1", "Value": 12345.6, "Unit": "AED Million" },
        { "Year": "2023", "Quarter": "Q2", "Value": 13210.3, "Unit": "AED Million" }
      ],
      "total": 48
    },
    "success": true
  }
  ```
  — `admin.bayanat.ae/api/opendata/GetDatasetResourceData` variant accepts `resourceID`, `query`, and `limit` params and returns filtered tabular rows.
- **Storage/ToS note:** Portal Terms and Conditions state data is published under the **UAE Open Data License**: users may reuse, copy, distribute, adapt, and exploit datasets for personal, academic, research, or commercial purposes. Attribution to the original UAE government entity (as indicated in dataset metadata) is required. Data must not be misrepresented or distorted. No explicit prohibition on caching or storing responses. License is broadly permissive (CC-BY-equivalent).
- **Verdict:** PARK — adds UAE-specific official government statistics (the only primary-official Gulf-state national data portal in scope), but is effectively inaccessible from outside the UAE/GCC region due to Cloudflare IP-blocking at the TCP level. No live confirmation possible. No engagement signals. Very low cadence (annual/quarterly stats). The GCC-Stat source (me-gccstat) already covers the Gulf macroeconomic statistics axis via a reliably accessible SDMX endpoint. Revisit only if a UAE-resident proxy or API mirror becomes available.
- **Risks:** (1) **Hard geo-restriction**: TCP-level timeout from non-UAE IPs makes the endpoint completely unusable in a cloud-hosted pipeline located outside the UAE. (2) **Cloudflare WAF**: Even if geo-restriction is lifted, Cloudflare bot-detection may block automated requests without a browser-like User-Agent or cookie. (3) **Custom (non-standard) API**: The `GetDatasetResource` REST wrapper is bespoke — not the standard CKAN `/api/3/action/` interface — and could change without notice. (4) **No API versioning**: No version identifier in the endpoint path; breaking changes would be silent. (5) **Overlap with me-gccstat**: Gulf macroeconomic context is already covered by GCC-Stat with a live-confirmed, accessible SDMX endpoint. (6) **Low signal density for news aggregation**: purely statistical tabular data with no content, no titles, no publication events — not suitable as a STORY source.
