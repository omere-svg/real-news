# Knesset OData — Votes & Committees  (SourceId: knesset-votes)

- **Tier:** A — primary-official (Israeli Parliament's own OData service, no intermediary)
- **Role:** BOTH — emits RawItem content (vote records as events) and SIGNAL (per-vote tallies: for/against/abstain counts usable as engagement signal)
- **Endpoint probed:** GET https://knesset.gov.il/Odata/Votes.svc/View_vote_rslts_hdr_Approved?$top=3&$format=json
- **Format:** OData v3 (JSON via `$format=json`, also returns Atom/XML by default)
- **Auth:** none   |   **Rate limit:** not published; pacing of ~1 req/s recommended as a courtesy for a government server
- **Probe status:** LIVE-CONFIRMED (HTTP 200, parsed 3 records, all fields verified)
- **Region mapping:** asserts Israel | Israel
- **Topic mapping:** parliamentary votes / committee sessions -> Politics
- **Signals yielded:** points? YES — `total_for`, `total_against`, `total_abstain` (integer vote tallies per vote; path: `value[].total_for` etc.); mentions? NO native mention count; tone? YES derivable — `is_accepted` (0/1) + for/against ratio encodes outcome polarity
- **externalId (dedup key):** `vote_id` (integer, globally unique per vote; example: `8`)
- **Sample response shape:**
  ```json
  {
    "vote_id": 8,
    "knesset_num": 16,
    "session_id": "15797",
    "sess_item_dscr": "הודעת ראש הממשלה על פעילות הממשלה",
    "vote_item_dscr": "הצעת סיכום",
    "vote_date": "2003-10-20T00:00:00",
    "vote_time": "20:08",
    "is_elctrnc_vote": 1,
    "is_accepted": 0,
    "total_for": 13,
    "total_against": 54,
    "total_abstain": 11
  }
  ```
- **Storage/ToS note:** Israeli government open-data services (data.gov.il and Knesset OData) are published under the Israeli Government Open Data License, which permits caching, redistribution, and derivative works with attribution. No scraping occurs — this is an official API. Attribution to "Knesset of Israel" required.
- **Verdict:** ADOPT — adds the dimension of **official recorded legislative votes with numeric for/against tallies**, the only source in the current six that delivers machine-readable parliamentary division results. HN gives community upvotes, arXiv gives academic citations, GDELT gives media tone — none give sovereign legislative voting records.
- **Risks:** (1) The existing `knesset` source (KNS_Bill bills adapter) overlaps in endpoint domain — careful namespace separation needed to avoid double-counting entity types. (2) All text is Hebrew-only; English translation requires an LLM pass. (3) Historical data starts at Knesset 16 (2003); pre-2003 sessions are absent. (4) Rate-limit policy is undocumented; aggressive polling could trigger IP blocks on a government server. (5) The `Votes.svc` and `ParliamentInfo.svc` are separate OData endpoints and must be joined on `session_id`/`PlenumSessionID` — the cross-service key relationship is stable but undocumented in metadata.

---

## Supporting notes

### Service landscape
Two distinct OData roots are relevant:

| Service | Base URL | Key entity sets |
|---------|----------|-----------------|
| ParliamentInfo.svc | https://knesset.gov.il/Odata/ParliamentInfo.svc/ | KNS_PlenumSession, KNS_CommitteeSession, KNS_PlmSessionItem, KNS_CmtSessionItem, KNS_Committee, KNS_Person, KNS_Faction |
| Votes.svc | https://knesset.gov.il/Odata/Votes.svc/ | View_vote_rslts_hdr_Approved (vote headers + tallies), vote_rslts_kmmbr_shadow (per-MK vote), View_Vote_MK_Individual (MK lookup) |

### Best primary endpoint
`Votes.svc/View_vote_rslts_hdr_Approved` is the richest single collection: each record is one named parliamentary vote with its aggregate result, and supports OData `$filter`, `$orderby`, `$top`/`$skip` for incremental ingestion.

### Incremental ingestion hint
Filter by `vote_date` using OData datetime filter syntax:
```
$filter=vote_date gt datetime'2024-01-01T00:00:00'&$orderby=vote_date asc
```

### Signal mapping
| Field | Maps to | Notes |
|-------|---------|-------|
| `total_for` | points-analog | raw integer, range 0–120 (Knesset has 120 seats) |
| `total_against` | inverse-points | |
| `total_abstain` | abstain count | |
| `is_accepted` | binary tone | 1=passed, 0=rejected |
| `total_for / (total_for + total_against)` | consensus ratio | derivable |
