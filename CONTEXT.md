# Project Horizon — Domain Context

The ubiquitous language of the system. Code, tests, and docs use these terms exactly.
Architecture vocabulary (Module, Interface, Seam, Adapter, Depth) lives separately in
the architecture review process — this file is about the *domain*, not the structure.

---

## Core nouns

**Raw Item**
A single verbatim payload extracted from one Source — e.g. one Hacker News post, one
GDELT article, one arXiv paper. Identified uniquely by `(source, externalId)`. Never
mutated after capture; it is the immutable provenance record. Lives in `raw_items`.

**Story**
A finalized, de-duplicated unit of intelligence — the read-model the presentation layer
consumes. A Story is the merge of one or more Raw Items that describe the same real-world
event. Carries a Topic, a Significance score, a factual Summary, and a Why-It-Matters. Lives in
`stories`.

**Cluster**
The set of Raw Items judged to be the same Story during a tick. Cluster size is itself a
signal: more independent Sources corroborating an event raises its Significance
(*corroboration*). A Cluster becomes (or updates) exactly one Story.

**Membership**
The link between a Raw Item and the Story it belongs to. The join that lets us count
corroboration and trace a Story back to its Sources. Lives in `membership`, keyed by
`(source, externalId)` — a Raw Item belongs to **exactly one** Story. Across ticks the
resolve/cluster stages can move an item to a different Story, so `upsert` releases the
item from its prior owner before re-attaching it (no primary-key collision).

**Source**
An official, public, stable developer API we extract from. Phase 1: Hacker News, GDELT,
Knesset (bills), arXiv, SEC EDGAR, Wikipedia. Phase 4 (ADR-0021) adds media + thematic
anchors: Guardian, Times of Israel, Knesset Votes, Hugging Face Daily Papers, NBER, Nature,
PsyArXiv. ADR-0031 adds a keyless wave covering the under-sourced fields: TheSportsDB (Sports),
WHO Disease Outbreak News (Health), and NASA EONET / USGS / GDACS (Climate) — via keyless
**RSS** (headline + summary + link only) or open JSON APIs. *Strictly zero scraping* —
APIs/feeds only, never HTML/UI parsing.

A source plays one of two **roles** (ADR-0021 §2, ADR-0025): a **Story source** emits Raw
Items that flow through the pipeline into the `stories` read-model; a **Signal source** emits
numeric observations that feed Significance as context but **never become a Story**. The two
satisfy sibling seams — `SourceAdapter` and `SignalSource` — so neither pollutes the other.

**Signal source**
A Source whose role is numeric, not narrative (ADR-0025): **Wikipedia Pageviews** (cross-lingual
reader attention; `en`⇒global, `he`⇒Israel), **World Bank** (macro volatility — the swing in
GDP-growth/inflation), and (ADR-0031) **CoinGecko** (crypto price-momentum ⇒ Business),
**Frankfurter FX** (major-pair daily volatility ⇒ Business), and **OpenAlex** (recent-research
citation impact ⇒ Science). It emits **Signal observations** — `{topic, key, value}`, where
`topic` is `null` for a global reading — that are observed fresh each tick (no persistence; the
data is slow-moving and CDN-cached) and reduced to a Topic-scoped *salience* that nudges
Significance within a bounded cap. Each Signal source declares its own `saturationReference` —
the scale its values log-normalize against — so the scoring module holds no per-source constants
(ADR-0031).

**Topic**
The single partition of a Story — a controlled vocabulary, not free text:
`AI`, `Geopolitics`, `Politics`, `Sports`, `Business`, `Science`, `Health`, `Climate`, `Israel`, `Other`.
`Israel` is a Topic like any other — a place you can follow, not a separate geographic axis;
a story primarily about Israel is classified `Israel` (place wins over subject).

**Significance**
A floating-point score `0.0–10.0` expressing macro-importance. Computed from *verifiable
signals*, **impact-first** (ADR-0034): real-world impact (a Reasoner-estimated [0,1] read on
casualties / disaster scale / major stakes), corroboration and source authority are combined so
a story strong on any axis approaches the top; social popularity is only a *bounded* booster
(never penalizing its absence), plus a *bounded* numeric-Signal nudge from the Topic's
attention/macro context (ADR-0025). The number the presentation layer sorts and budgets by.

**Signals**
The verifiable inputs to Significance: source popularity/velocity (e.g. HN points),
mention count / tone (GDELT), source weight, recency decay, and corroboration (Cluster
size). Deterministic and inspectable — never invented by the model.

**Score Breakdown**
The persisted, inspectable "why this score" attached to a Story (ADR-0032): the deterministic
`base` decomposed into per-component contributions (popularity, engagement, corroboration,
tone-extremity, source-weight), the `recencyFactor` applied, and the two bounded nudges
(`editorialAdjustment`, `signalNudge`). `base + editorialAdjustment + signalNudge`, clamped,
reconciles to the Story's `significance`. Snapshotted at scoring time and surfaced verbatim —
the proof that Significance is math, not a black-box rating.

**Summary**
The concise factual "what happened" string attached to a Story — the reporter output, distinct
from the editorial Why-It-Matters. Written by the Reasoner's **deep tier** on the top-N
significant Stories (`null` until then); a boot-time **backfill** self-heals older Stories that
predate the field, most-significant first, so the brief fixes itself without a manual pass.

**Why-It-Matters**
The analytical justification string attached to a Story explaining its importance. The
"executive editor" output, paired with the factual Summary. Generated by the Reasoner's **deep
tier** only for the top-N most significant Stories.

**Memory**
A single free-text note a chat keeps about itself (ADR-0028) — who it is, what it cares about —
that is injected as reader context into narration and chat. `/remember <text>` appends; `/forget`
clears. Distinct from Preference weights (which bias *ranking*); Memory biases *phrasing*.

**Preference weight**
A per-Topic multiplier a single chat sets to bias its own briefs (ADR-0026):
neutral = 1, `>1` emphasizes, `<1` de-emphasizes, `0` mutes (hidden). Applied at *ranking* time
in Presentation (`significance × weight`) — it never changes the global, objective Significance,
only this user's ordering. Persisted per chat alongside the other preferences.

**Feedback**
A user's free-text note on what was good or bad (`/feedback more AI, less sports, shorter`). The
Reasoner interprets it into a structured *intent* (directions, never numbers); the pure
`applyFeedback` turns that into clamped Preference-weight changes. One-level `/feedback undo`
reverts the last change. The model interprets; deterministic code does the math (ADR-0026).

---

## Core verbs (the tick pipeline)

The background loop wakes every `X` minutes (the **tick**) and runs these stages in order:

1. **Extract** — pull Raw Items from each healthy Story Source; in parallel **Observe** numeric
   readings from each healthy Signal source (ADR-0025), reduced to this tick's signal context.
2. **Persist Raw** — idempotently upsert Raw Items by `(source, externalId)`.
3. **Classify** — assign a Topic (metadata-first, Reasoner fallback).
4. **Embed** — vectorize each item's title + body lead for similarity, so same-event
   articles across outlets converge (neural OpenAI embeddings, hashing fallback; ADR-0035).
5. **Cluster** — find candidate same-Story pairs by embedding proximity, then the
   Reasoner confirms the merge.
6. **Resolve** — match each Cluster against recent stored Stories (same Topic) and,
   on a Reasoner-confirmed embedding match, merge into that Story so it accretes
   corroboration across ticks (cross-tick dedup); otherwise assign a fresh stable id.
7. **Score** — compute Significance impact-first (ADR-0034): real-world impact + corroboration +
   authority, social popularity a bounded booster, + a bounded
   numeric-Signal nudge from the Topic's attention/macro context.
8. **Analyze** — escalate the top-N most significant Clusters to the deep tier for the factual
   Summary and the editorial Why-It-Matters (one call, both fields).
9. **Upsert Stories** — write finalized Stories to the read-model (and persist their embedding).

**Tick** — one full pass of the pipeline. **Tick Report** — its structured outcome
(counts, skipped Sources, errors), returned by the runner and **persisted** to `tick_reports`
each tick — successes and failures alike — for observability (ADR-0033). Surfaced on the
read-only `/dashboard` health page and the `/api/ticks` JSON feed.

---

## Roles / agents

**Extraction Worker** — the daemon that schedules and triggers ticks; isolates per-Source
failures so one dead endpoint never crashes the loop.

**Reasoner** — the LLM behind the model seam (ADR-0016): owns prompts, schemas, and tier
choice over a thin `ChatTransport` (OpenAI today). The **cheap tier** does high-volume work
(classification fallback, merge confirmation, pre-scoring, cross-tick confirm, plus the bot's
intent routing and plain-language preference parsing — ADR-0030); the **deep tier** does the
Summary + Why-It-Matters analysis on the top-N, the podcast narration, and chat about the news
(ADR-0029). Wrapped in `ResilientLLMClient` so a model outage degrades the tick instead of
crashing it.

**Presentation Layer** — read-only surfaces over finalized Stories, mapping user constraints
(time budget, topic preferences) onto the pre-computed Significance scores via the
`QueryEngine`. Two adapters: the single-page **web viewer** and the **Telegram bot** (text
briefs, topic outlines, and podcast audio; per-chat preferences and Memory). The bot's primary
UX is **plain English + tap-to-run buttons** (ADR-0030) — free text is routed to an intent;
slash commands (`/brief`, `/outline`, `/podcast`, `/chat`, `/prefs`, `/feedback`, `/remember`,
`/forget`) remain as aliases. It also supports **Chat** — conversational Q&A grounded in the
cached Stories, escalating to an optional **web search** fallback only when the cache can't
answer and only when configured (ADR-0029, off by default). The brief and outline read the
cache only; chat's web fallback is the one deliberate exception.
