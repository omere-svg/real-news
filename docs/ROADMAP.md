# Project Horizon — Status & Roadmap

Living document: where the codebase stands vs. the vision in `../project-idea.txt`, and
the plan to finish it. Updated 2026-06-18 (**230 tests green, 27 ADRs**). Phases 1–4 complete
(all 9 Phase-4 sources built, incl. the 2 numeric Signal sources + the Story/Signal split,
ADR-0025); security & resource hardening and brief-readability complete. Only Phase 5
(productionize) remains.

---

## 1. What we have (built, tested)

| Layer | Modules | Status |
|---|---|---|
| **Extraction worker** (Feature 1) | `pipeline/extract` + **13 Story adapters** behind the `SourceAdapter` seam (ADR-0004): Hacker News, arXiv, GDELT, Knesset bills, SEC EDGAR, Wikipedia, **Guardian, Times of Israel, Knesset Votes, HF Daily Papers, NBER, Nature, PsyArXiv** (ADR-0021); plus **2 Signal adapters** behind the sibling `SignalSource` seam (`pipeline/observe-signals`): **Wikipedia Pageviews, World Bank** (ADR-0025). Shared `rss.ts` parser for RSS/RDF feeds. Health-checked, per-source failure isolation. | ✅ |
| **Relational cache** (Feature 2) | SQLite + Drizzle (ADR-0002/0005): `raw_items` → `stories` → `membership`, plus `story_vectors` (ADR-0017), `chat_preferences` + `usage` (ADR-0019/0022). Idempotent upsert (reassigns a member across Stories without a `(source, externalId)` PK collision); filtered `topStories`. | ✅ |
| **Reasoning loop** (Feature 3) | `classify → embed → cluster → resolve → score → analyze → upsert`, sequenced by `TickRunner`. `computeBaseScore` (verifiable signals) + bounded LLM nudge. `Reasoner` (prompts/schemas/tiering) over a thin `ChatTransport` (OpenAI), wrapped in `ResilientLLMClient` (ADR-0016). Neural `OpenAIEmbedder` + hashing fallback (ADR-0018). Cross-tick dedup via `resolve` (ADR-0017). | ✅ |
| **Scheduler / daemon** | In-process tick loop every X min (`main.ts`, ADR-0001). | ✅ |
| **Config** | YAML + Zod (`config/horizon.yaml`, ADR-0003). | ✅ |
| **Presentation** (Phase 2) | Read-only **query layer**: `budgetStories` attention kernel with a **readability floor** (ADR-0013/0024) + `HorizonQuery` (text brief, topic outline, podcast script, ADR-0014) over `GET /api/stories\|brief\|outline\|podcast`, plus a single-page viewer. Config-driven preferences (ADR-0015). | ✅ |
| **Telegram bot** | Second Presentation adapter (ADR-0019/0020): `/brief\|outline\|podcast\|prefs\|feedback\|start`, per-chat persisted preferences, long-poll, podcast **audio** via OpenAI TTS, message-splitting for the 4096-char limit. **Free-text `/feedback`** tunes per-chat soft preference weights — the Reasoner interprets intent, pure `applyFeedback` does the clamped math, a weighted re-rank biases briefs; one-level undo (ADR-0026). | ✅ |
| **Security & hardening** | Default-deny access, rate limits + persisted cost quotas, minutes clamp, localhost bind, fetch timeout/size caps, DB `0600` (ADR-0022/0023). | ✅ |

Principles 1–5 are realized. Decisions are in `docs/adr/0001–0024`; domain language in `../CONTEXT.md`.

---

## 2. Gap vs. the vision

| Vision element | Status |
|---|---|
| **Text bullet brief** | ✅ `HorizonQuery.textBrief` (ADR-0014), readability floor (ADR-0024) |
| **Audio podcast** | ✅ `podcastScript` → `narrate` → OpenAI TTS audio in Telegram (ADR-0020) |
| **Topic-focused outline** | ✅ `topicOutline`, grouped by Region (ADR-0014) |
| **Attention & time budgeting** (Principle 5) | ✅ `budgetStories` — readability-first allocator (ADR-0013/0024) |
| **User preferences** | ✅ config defaults (ADR-0015) + per-chat persisted prefs for the bot (ADR-0022) |
| **Cross-tick dedup** | ✅ `resolve` stage + persisted `story_vectors` (ADR-0017) |
| **Neural embedder** | ✅ `OpenAIEmbedder` + resilient hashing fallback (ADR-0018) |
| **Mainstream-media + thematic sources** | ✅ 7 added: Guardian, Times of Israel, Knesset Votes, HF Papers, NBER, Nature, PsyArXiv (ADR-0021) |
| **Numeric Signal sources** (Wikipedia Pageviews, World Bank) + Story/Signal split | ✅ `SignalSource` seam + bounded partition nudge into scoring (ADR-0025) |
| Real deployment (Turso + host), observability | ⚠️ Docker/README ready, not deployed |

---

## 3. Plan to complete (ordered by value)

Each step is TDD'd behind the seams already in place.

### ✅ Phase 2 — Query / Presentation layer *(DONE)*
`HorizonQuery` over `StoryRepo`; `budgetStories` attention kernel (ADR-0013) with a
readability floor + max-stories cap (ADR-0024); text brief, topic outline, podcast script
(ADR-0014); config-driven preferences (ADR-0015).

### ✅ Phase 3 — Deeper reasoning across time *(DONE)*
7. ✅ **Persist embeddings + cross-tick dedup** — `resolve` stage, `story_vectors` (ADR-0017).
8. ✅ **Neural embedder** — `OpenAIEmbedder` + `ResilientEmbedder` fallback (ADR-0018).

### ✅ Telegram Bot interface *(DONE)*
Second Presentation adapter (ADR-0019/0020): command kernel, dispatcher, Bot API transport
(long-poll + message-splitting), per-chat prefs, podcast audio via TTS.

### ✅ Security & resource hardening *(DONE)*
Default-deny access, burst limit + persisted daily quotas (per-chat + global ceiling), minutes
clamp, web `/api/podcast` off by default, localhost bind, `fetchJson` timeout/size caps, DB
`0600`, per-chat preference isolation (ADR-0022/0023).

### ✅ Phase 4 — Breadth *(DONE)*
*Source strategy set by **ADR-0021** (lean, media-aware MVP): 2-value Region kept; a media +
4-theme set of 9 sources adopted; the rest PARKed in `docs/research/` as reference.*
9. ✅ **Story/Signal seam + numeric Signal sources** (ADR-0025) — a companion `SignalSource`
   seam (sibling to `SourceAdapter`, so the Story pipeline is untouched); **Wikipedia
   Pageviews** (attention) + **World Bank** (macro volatility) observed in-tick and folded into
   significance as a bounded, partition-scoped nudge alongside the editorial adjustment.
   `computeBaseScore` unchanged.
10. ✅ **Media + thematic Story sources** (ADR-0021) — Guardian + Times of Israel (RSS),
    Knesset Votes (OData), HF Daily Papers, NBER, Nature, PsyArXiv. Shared RSS parser added.

### ▶ Phase 5 — Productionize
11. **Deploy** (Turso + Railway/Render), **observability** (persist `TickReport`, metrics),
    GDELT rate-limit pacing.

---

**Recommended next:** Phase 5 — deploy (Turso + host) + observability (persist `TickReport`).
The entire MVP vision is now built and tested; only productionization remains. Optional
deepening: entity-link Pageviews to clusters and persist Signal history (both noted in ADR-0025).
