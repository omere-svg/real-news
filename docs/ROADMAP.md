# Project Horizon — Status & Roadmap

Living document: where the codebase stands vs. the vision in `../project-idea.txt`, and
the plan to finish it. Updated 2026-06-17 (149 tests green, 20 ADRs — Phases 2 & 3 + the
Telegram bot complete).

---

## 1. What we have (built, tested)

The entire background engine — Phase 1's 3 features — is done and running.

| Layer | Modules | Status |
|---|---|---|
| **Extraction worker** (Feature 1) | `pipeline/extract` stage + 6 adapters behind the `SourceAdapter` seam: Hacker News, arXiv, GDELT, Knesset, SEC EDGAR, Wikipedia. Health-checked, per-source failure isolation. | ✅ |
| **Relational cache** (Feature 2) | SQLite + Drizzle; `raw_items` → `stories` → `membership`; idempotent upsert; `topStories` read. | ✅ |
| **Reasoning loop** (Feature 3) | `classify → embed → cluster → resolve → score → analyze`, sequenced by `TickRunner`. `computeBaseScore` (verifiable signals) + bounded LLM nudge. `Reasoner` (prompts/schemas/tiering) over a thin `ChatTransport` (OpenAI), wrapped in `ResilientLLMClient` (ADR-0016). Cross-tick dedup via `resolve` (ADR-0017). | ✅ |
| **Scheduler / daemon** | In-process tick loop every X min (`main.ts`). | ✅ |
| **Config** | YAML + Zod (`config/horizon.yaml`). | ✅ |
| **Presentation** (Phase 2) | Full read-only **query layer**: `budgetStories` attention kernel + `HorizonQuery` (text brief, topic outline, podcast script) over `GET /api/stories\|brief\|outline\|podcast`, with a single-page viewer (format switch, time slider, topic/region toggles). Config-driven preferences. | ✅ |
| **Telegram bot** | Second Presentation adapter (ADR-0019/0020): `/brief\|outline\|podcast\|prefs`, per-chat preferences, long-poll, podcast **audio** via OpenAI TTS. | ✅ |

Principles 1–5 are realized. Decisions are in `docs/adr/0001–0017`; domain language in
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
| **Cross-tick dedup** — merge a new item into an *existing* story from a prior tick | ✅ `resolve` stage: block by Region/Topic + recency window, cosine-match stored embeddings, Reasoner-confirm, merge (ADR-0017) |
| **Persisted embeddings / vector store** (needed for cross-tick dedup) | ✅ `story_vectors` table; representative vector stored each upsert |
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

### ✅ Phase 3 — Deeper reasoning (clustering across time) *(DONE 2026-06-17)*
7. ✅ **Persist embeddings + cross-tick dedup** — `resolve` stage blocking-matches new clusters against recent *stored* stories (in-memory cosine over a Region/Topic + recency window), Reasoner-confirms, and merges, so a developing story accretes corroboration over hours (ADR-0017). *Biggest correctness upgrade to the "active editor" — done.*
8. ✅ **Neural embedder** — `OpenAIEmbedder` (`text-embedding-3-small`) behind the `Embedder` seam, wrapped in `ResilientEmbedder` (falls back to hashing on outage). Config-driven; `provider: hashing` stays for offline runs (ADR-0018).

### ✅ Telegram Bot interface *(DONE 2026-06-17)*
- A second Presentation adapter over the same `QueryEngine`/`StoryRepo` seams (ADR-0019):
  `parseCommand` kernel, `HorizonBot` dispatcher, thin `TelegramTransport` (Bot API via
  `fetch`, long-poll), per-chat persisted preferences (`ChatPreferencesRepo`), chat-id
  allowlist. Commands: `/brief`, `/outline`, `/podcast`, `/prefs`, `/start`.
- **Podcast audio** via a `Synthesizer` seam + `OpenAITTS`, resilient (falls back to text);
  the vision's audio podcast (ADR-0020). Off by default (`telegram.enabled`).

### ▶ Phase 4 — Breadth
9. **Signal inputs** (FX, World Bank, crypto) feeding `Signals`/significance — scoring context, not stories.
10. **More sources** — Google Trends, data.gov.il adapter, a Sports source.

### ▶ Phase 5 — Productionize
11. **Deploy** (Turso + Railway/Render), **observability** (persist `TickReport`, metrics), GDELT rate-limit pacing.

---

**Recommended next:** Phase 4 — **numeric Signal inputs** (FX / World Bank / crypto) feeding
significance, then **more sources** (Google Trends, data.gov.il, Sports). After that,
Phase 5 deploy + observability.
