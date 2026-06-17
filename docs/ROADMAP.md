# Project Horizon — Status & Roadmap

Living document: where the codebase stands vs. the vision in `../project-idea.txt`, and
the plan to finish it. Updated 2026-06-17 (96 tests green, 15 ADRs — Phase 2 complete).

---

## 1. What we have (built, tested)

The entire background engine — Phase 1's 3 features — is done and running.

| Layer | Modules | Status |
|---|---|---|
| **Extraction worker** (Feature 1) | `pipeline/extract` stage + 6 adapters behind the `SourceAdapter` seam: Hacker News, arXiv, GDELT, Knesset, SEC EDGAR, Wikipedia. Health-checked, per-source failure isolation. | ✅ |
| **Relational cache** (Feature 2) | SQLite + Drizzle; `raw_items` → `stories` → `membership`; idempotent upsert; `topStories` read. | ✅ |
| **Reasoning loop** (Feature 3) | `classify → embed → cluster/dedup → score → analyze`, sequenced by `TickRunner`. `computeBaseScore` (verifiable signals) + bounded LLM nudge. OpenAI reasoner behind `LLMClient`, wrapped in `ResilientLLMClient`. | ✅ |
| **Scheduler / daemon** | In-process tick loop every X min (`main.ts`). | ✅ |
| **Config** | YAML + Zod (`config/horizon.yaml`). | ✅ |
| **Presentation** (Phase 2) | Full read-only **query layer**: `budgetStories` attention kernel + `HorizonQuery` (text brief, topic outline, podcast script) over `GET /api/stories\|brief\|outline\|podcast`, with a single-page viewer (format switch, time slider, topic/region toggles). Config-driven preferences. | ✅ |

Principles 1–5 are realized. Decisions are in `docs/adr/0001–0015`; domain language in
`../CONTEXT.md`.

---

## 2. Gap vs. the vision

| Vision element | Status |
|---|---|
| **Text bullet brief** | ✅ `HorizonQuery.textBrief` (ADR-0014) |
| **Audio podcast script** | ✅ `podcastScript` via Reasoner `narrate`, degrades to the brief (ADR-0014) |
| **Topic-focused outline** | ✅ `topicOutline`, grouped by Region (ADR-0014) |
| **Attention & time budgeting** (Principle 5) | ✅ pure `budgetStories` inverted-pyramid kernel (ADR-0013) |
| **User preferences** (topics/regions you care about) | ✅ config-driven defaults wired into query engine + viewer (ADR-0015) |
| **Cross-tick dedup** — merge a new item into an *existing* story from a prior tick | ❌ `cluster()` only sees the current tick's batch (no DB lookup) |
| **Persisted embeddings / vector store** (needed for cross-tick dedup) | ❌ embeddings computed then discarded |
| Neural embedder (currently a hashing stand-in) | ⚠️ works, lower-quality dedup |
| Extra sources: Google Trends, data.gov.il, numeric **signals** (FX/World Bank/crypto), Sports | ❌ |
| Real deployment (Turso + host), observability | ⚠️ Docker/README ready, not deployed |

**Phase 2 closed:** the user-facing **query/presentation layer** — the "executive editor"
turning the cache into briefs/scripts/outlines under a time budget — is now fully
implemented and tested. The remaining gaps are deeper reasoning (Phase 3) and breadth/deploy
(Phases 4–5).

---

## 3. Plan to complete (ordered by value)

Each step is TDD'd behind the seams already in place.

### ✅ Phase 2 — Query / Presentation layer *(core remaining vision — DONE 2026-06-17)*
1. ✅ **`HorizonQuery` over `StoryRepo`** — reads a Significance-ranked pool and filters by the request's regions/topics (ADR-0014).
2. ✅ **Attention & time budgeting** — pure `budgetStories(stories, minutes, params)`: an inverted-pyramid allocator (breadth then top-heavy depth), tunable cost model (ADR-0013).
3. ✅ **Text bullet brief** — `textBrief(request)`: deterministic render of stored fields over the budgeted selection, depth-aware (ADR-0014).
4. ✅ **Topic-focused outline** — `topicOutline(topic, request)`: grouped by Region.
5. ✅ **Audio podcast script** — `podcastScript(request)`: new Reasoner `narrate` (deep tier) turns the budgeted brief into spoken narration; degrades to the brief on failure. *Stretch (real TTS → audio file) still open.*
6. ✅ **User preferences** — config-driven (`presentation` block) defaults wired into the query engine + viewer (time slider, topic/region toggles) (ADR-0015).

### ▶ Phase 3 — Deeper reasoning (clustering across time)
7. **Persist embeddings + cross-tick dedup** — each tick, blocking-match new items against recent *stored* stories (sqlite-vec or in-memory cosine over a recent window) and merge, so a developing story accretes corroboration over hours, not just within one tick. *Biggest correctness upgrade to the "active editor."*
8. **Neural embedder** behind the `Embedder` seam (transformers.js or an embeddings API) for better dedup quality.

### ▶ Phase 4 — Breadth
9. **Signal inputs** (FX, World Bank, crypto) feeding `Signals`/significance — scoring context, not stories.
10. **More sources** — Google Trends, data.gov.il adapter, a Sports source.

### ▶ Phase 5 — Productionize
11. **Deploy** (Turso + Railway/Render), **observability** (persist `TickReport`, metrics), GDELT rate-limit pacing.

---

**Recommended next:** Phase 3 step 7 (persist embeddings + cross-tick dedup) — the biggest
correctness upgrade to the "active editor," so a developing story accretes corroboration
across ticks rather than only within one.
