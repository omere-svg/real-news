# Project Horizon — Status & Roadmap

Living document: where the codebase stands vs. the vision in `../project-idea.txt`, and
the plan to finish it. Updated 2026-07-05 (**341 tests green, 38 ADRs**; live on Render +
Turso). A production-DB review drove a throughput/dedup/integrity hardening pass
(**ADR-0038**): bounded-concurrency ticks (~17 min → ~1.5 min), a re-entrancy guard,
orphan-Story pruning, cross-topic cross-tick dedup, a sharper classifier (`Other` 22% → 6%),
and steady-state summary/why backfill. Phases 1–4 complete
(all 9 Phase-4 sources built, incl. the 2 numeric Signal sources + the Story/Signal split,
ADR-0025); security & resource hardening and brief-readability complete. **ADR-0031** adds the
`Health` + `Climate` Topics and a keyless source wave (TheSportsDB→Sports, WHO→Health, NASA
EONET/USGS/GDACS→Climate; CoinGecko/Frankfurter→Business + OpenAlex→Science signals), and moves
each Signal source's saturation scale onto the `SignalSource` seam. **Phase 6
(presentation deepening) is now done** — brief provenance links, per-chat memory + inline
per-answer feedback, a cache-grounded chat-about-the-news with an off-by-default web
fallback, and a natural-language + buttons UX over the bot (ADR-0027/0028/0029/0030).
**Phase 5 (productionize) is now done too** — deployed live on Render + Turso (ADR-0031) and
fully observable via persisted tick reports + a `/dashboard` (ADR-0033). Every Story also ships
an inspectable score breakdown (ADR-0032). A scoring/dedup hardening pass followed: **impact-first
Significance** (ADR-0034), **richer dedup embeddings + entity-aware clustering** (ADR-0035/0036),
generic-title cleanups (Knesset / GDACS / SEC), and a single **Score-Explanation** seam + small
shared utilities from an architecture review (ADR-0037). **All planned phases are complete**; what
remains is optional deepening (below).

---

## 1. What we have (built, tested)

| Layer | Modules | Status |
|---|---|---|
| **Extraction worker** (Feature 1) | `pipeline/extract` + **18 Story adapters** behind the `SourceAdapter` seam (ADR-0004): Hacker News, arXiv, GDELT, Knesset bills, SEC EDGAR, Wikipedia, **Guardian, Times of Israel, Knesset Votes, HF Daily Papers, NBER, Nature, PsyArXiv** (ADR-0021), **TheSportsDB (Sports), WHO Outbreaks (Health), NASA EONET / USGS / GDACS (Climate)** (ADR-0031); plus **5 Signal adapters** behind the sibling `SignalSource` seam (`pipeline/observe-signals`): **Wikipedia Pageviews, World Bank** (ADR-0025), **CoinGecko, Frankfurter FX, OpenAlex** (ADR-0031). Shared `rss.ts` parser for RSS/RDF feeds. Health-checked, per-source failure isolation. | ✅ |
| **Relational cache** (Feature 2) | SQLite + Drizzle (ADR-0002/0005): `raw_items` → `stories` → `membership`, plus `story_vectors` (ADR-0017), `chat_preferences` + `usage` (ADR-0019/0022). Idempotent upsert (reassigns a member across Stories without a `(source, externalId)` PK collision); filtered `topStories`. | ✅ |
| **Reasoning loop** (Feature 3) | `classify → embed → cluster → resolve → score → analyze → upsert`, sequenced by `TickRunner`. Impact-first `computeBaseScore` — real-world impact (Reasoner `assessImpact`) + corroboration + authority, popularity a bounded booster (ADR-0034). `Reasoner` (prompts/schemas/tiering) over a thin `ChatTransport` (OpenAI), wrapped in `ResilientLLMClient` (ADR-0016). Neural `OpenAIEmbedder` + hashing fallback (ADR-0018). Cross-tick dedup via `resolve` (ADR-0017). | ✅ |
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
| **Topic-focused outline** | ✅ `topicOutline`, flat by significance (ADR-0014; region grouping dropped in ADR-0030) |
| **Attention & time budgeting** (Principle 5) | ✅ `budgetStories` — readability-first allocator (ADR-0013/0024) |
| **User preferences** | ✅ config defaults (ADR-0015) + per-chat persisted prefs for the bot (ADR-0022) |
| **Cross-tick dedup** | ✅ `resolve` stage + persisted `story_vectors` (ADR-0017) |
| **Neural embedder** | ✅ `OpenAIEmbedder` + resilient hashing fallback (ADR-0018) |
| **Mainstream-media + thematic sources** | ✅ 7 added: Guardian, Times of Israel, Knesset Votes, HF Papers, NBER, Nature, PsyArXiv (ADR-0021) |
| **Numeric Signal sources** (Wikipedia Pageviews, World Bank) + Story/Signal split | ✅ `SignalSource` seam + bounded partition nudge into scoring (ADR-0025) |
| **Source provenance in the brief** | ✅ per-bullet `🔗 url` in the deterministic renderer; upsert guarantees a member's article link (ADR-0027) |
| **Personal memory + in-flow feedback** | ✅ `/remember`+`/forget` injected into LLM paths; per-answer "Give feedback" button (ADR-0028) |
| **Chat about the news** | ✅ cache-grounded `discuss` with off-by-default web fallback (ADR-0029) |
| **Natural-language + buttons UX** | ✅ cheap-tier intent router + tap-to-run menus; slash commands kept as aliases (ADR-0030) |
| **Structured story cards (what-happened + why-it-matters)** | ✅ deep tier writes a factual `summary` alongside `whyItMatters`; for non-top-N stories a deterministic `summary` falls back to the source text (markup-stripped, ≤2 sentences) so every text-bearing story has a "what happened"; renderer = 📰 headline → what happened → 💡 why it matters → 🏷 tag → 🔗 link; upsert always keeps a member's article URL; cache **self-heals on boot** for stories missing a summary (`reasoner.backfillOnBoot`) + `npm run backfill:summaries` |
| **Knesset bill provenance** | ✅ bills now carry a real link (`BillID`=site `lawitemid`) + `SummaryLaw` text when present; Hebrew titles get a plain-English "what happened" via the backfill |
| **Inspectable score breakdown** ("why this score") | ✅ persisted `scoreBreakdown` per Story, surfaced in the web viewer (expandable) + a compact rationale in the brief/bot (ADR-0032) |
| Real deployment (Turso + host) | ✅ **live in production** on Render free tier + hosted Turso; push-to-`main` auto-redeploys (ADR-0031, `docs/DEPLOY-RENDER.md`) |
| Observability (persist `TickReport`, dashboard) | ✅ `tick_reports` table + `TickReportRepo`; `/dashboard` health page + `/api/ticks` JSON; failed ticks recorded too (ADR-0033) |
| **Impact-first Significance** (real-world impact beats popularity) | ✅ noisy-OR of impact + corroboration + authority, popularity a bounded booster, floored recency (ADR-0034) |
| **Dedup quality** (same-event articles merge) | ✅ title+body-lead embeddings (ADR-0035) + toggleable entity-aware blocking (ADR-0036) + generic-title fixes (Knesset/GDACS/SEC); dedicated `GdacsSource` |
| **Score interpretation** single-sourced | ✅ `scoreExplanation` seam feeds both the brief rationale and the web "Why this score?" (ADR-0037) |

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
*Source strategy set by **ADR-0021** (lean, media-aware MVP): 2-value Region kept (later folded
into Topic by ADR-0030 — `Israel` is now a Topic); a media + 4-theme set of 9 sources adopted;
the rest PARKed in `docs/research/` as reference.*
9. ✅ **Story/Signal seam + numeric Signal sources** (ADR-0025) — a companion `SignalSource`
   seam (sibling to `SourceAdapter`, so the Story pipeline is untouched); **Wikipedia
   Pageviews** (attention) + **World Bank** (macro volatility) observed in-tick and folded into
   significance as a bounded, partition-scoped nudge alongside the editorial adjustment.
   `computeBaseScore` unchanged.
10. ✅ **Media + thematic Story sources** (ADR-0021) — Guardian + Times of Israel (RSS),
    Knesset Votes (OData), HF Daily Papers, NBER, Nature, PsyArXiv. Shared RSS parser added.

### ✅ Phase 6 — Presentation deepening *(DONE)*
12. ✅ **Per-bullet source links (provenance in the brief)** (ADR-0027) — the deterministic
    renderer appends `🔗 <article url>` to each Story, flowing into both the web `<pre>` and
    Telegram. Pure, no I/O, budget-neutral. The upsert now guarantees a link: it falls back from
    the representative's URL to the first member that carries one, so a Story is never link-less
    when any corroborating item has a URL.
13. ✅ **Per-chat memory + in-flow feedback** (ADR-0028) — `/remember`/`/forget` keep a
    free-text personal context injected into the LLM content paths (podcast narration, chat);
    every answer carries a one-tap "✍️ Give feedback" button that routes the next message into
    the ADR-0026 tuning path.
14. ✅ **Chat about the news** (ADR-0029) — after a brief, plain text (or `/chat`/`/ask`) is a
    question answered by a cache-grounded `discuss` (deep tier), with an **off-by-default**
    `WebSearch` seam (Tavily) escalated only when the cache can't answer. Telegram-only,
    quota-bounded, resilient.
15. ✅ **Natural-language + buttons UX** (ADR-0030) — a cheap-tier `routeIntent` seam maps plain
    English to the existing commands, and tap-to-run menus (main menu + topic picker) drive the
    bot without slash syntax. A companion `interpretPrefs` seam applies plain-language preference
    edits (reset, set/add/remove topics, default minutes). Action taps draw the same
    quota as typed commands; slash commands stay as power-user aliases. Gated by
    `telegram.naturalLanguage` (default on).

### ✅ Phase 5 — Productionize *(DONE)*
11. ✅ **Deploy** (Turso + Render) — live, push-to-`main` auto-redeploys (ADR-0031).
12. ✅ **Observability** (ADR-0033) — every tick's outcome persisted to `tick_reports`
    (success *and* failure), surfaced on a self-refreshing `/dashboard` health page +
    `/api/ticks` JSON feed.
    **Optional follow-ups:** GDELT rate-limit pacing; GDELT signal enrichment (its artlist
    endpoint exposes no per-article tone/mentions — ADR-0032 note); a retention prune for
    `tick_reports`; an LLM "reflection" advisor over the persisted history (ADR-0033).

### ✅ Score transparency *(DONE)*
16. ✅ **Inspectable score breakdown** (ADR-0032) — `computeBaseScore` now also yields a
    per-component decomposition; the Score stage snapshots it with the bounded editorial +
    numeric-Signal nudges as a persisted `scoreBreakdown`. The web viewer shows an expandable
    "Why this score?"; the brief/bot append a compact rationale (`· 4 sources · trending · fresh`).

---

**Status:** all planned phases (1–6 + productionize) are built, tested, and **live in
production**. The full MVP vision plus the Phase-6 deepening, score transparency (ADR-0032),
and observability (ADR-0033) are done.

**Optional further deepening (no longer on the critical path):** GDELT signal enrichment
(ADR-0032 note; rate-limit pacing resolved in ADR-0039); a retention prune + LLM "reflection" advisor over
`tick_reports` (ADR-0033); semantic retrieval over `story_vectors` for chat grounding;
per-member source URLs in the brief; entity-linking Pageviews to clusters / persisting Signal
history (noted in ADR-0025).

---

## 4. Production hardening pass — ADR-0038 (resolved 2026-07-05)

A deep review of the live Turso DB (478 ticks) surfaced four real gaps invisible to the
unit tests. All four are now **fixed and verified** on a fresh end-to-end run (3 ticks,
real sources + OpenAI):

| Was (prod, old code) | Now (ADR-0038, verified) |
|---|---|
| Tick wall-time **~17–21 min** > 15-min interval; `setInterval` with no guard → overlapping ticks | Bounded-concurrency confirm calls (`dedup.confirmConcurrency`) → **~1.5 min/tick**; re-entrancy guard in `main.ts`; interval raised to 20 |
| **~40 member-less stories** left by cross-tick reassignment | `StoryRepo.pruneOrphans()` each tick → **0** member-less stories, 0 orphans, 0 missing vectors |
| Same event fragmented into **13+ stories** (resolve's same-Topic gate + inconsistent classification) | `dedup.crossTopic` resolve (LLM-confirmed) + stable-topic-on-merge + same-id folding; Venezuela quakes now **one `Climate` story** |
| **`Other` ~22%**; disasters mis-tagged; Guardian world hard-coded to `Geopolitics` | Topic-defining classify prompt + Guardian world un-hardcoded → **`Other` ~6%**, disasters ⇒ `Climate` |
| `why_it_matters` null ~91%, `summary` ~31%; backfill only on boot | `needsAnalysis` backfill (summary **or** why) + steady-state `reasoner.backfillPerTick`; converges over time |

Every change is behind a config flag with a safe default and needs no migration
(`crossTopic: false` reverts to same-Topic resolve). See ADR-0038 for the full rationale.

**Residual (not blocking):** classification still has rare edge cases (a sports
retrospective that mentioned an earthquake landed in `Climate`). **Deploy note:** the live
prod DB keeps the old behaviour until Render redeploys the new code (push to `main`).

## 5. Follow-up hardening — ADR-0039 (resolved 2026-07-05)

A second review — of a **freshly wiped prod DB refilled by the ADR-0038 code** — confirmed
those fixes landed (`Other` 22% → 7.5%, 0 orphans, 0 duplicate titles, Venezuela quakes as
one `Climate` story) and surfaced two residuals, now fixed:

| Was (ADR-0038 refill) | Now (ADR-0039, verified) |
|---|---|
| **GDELT skipped every tick** (health-check + extract = 2 calls back-to-back trip its 1-req/5s limit) → **`Geopolitics` 0.8%** | `GdeltSource.healthCheck()` makes no probe → one request/tick; GDELT contributes every tick |
| **`whyItMatters` ~92% null** after 2 ticks; `backfillSummaries` analyzed **serially** so the 500-Story boot heal took many minutes | Backfill runs with **bounded concurrency** (reuses the ADR-0038 `mapWithConcurrency`); boot/per-tick heal finish fast; `backfillPerTick` 8 → 12 |

Cost stays bounded — concurrency changes *throughput*, not the per-call count. See ADR-0039.
