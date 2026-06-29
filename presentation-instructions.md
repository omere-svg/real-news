# NotebookLM Presentation Generator — Instructions for "Project Horizon"

This file tells the NotebookLM presentation generator **exactly** what deck to build for a
live presentation to the **Operations Director**. Follow it top-to-bottom.

---

## STEP 0 — Load these sources into NotebookLM first

Before generating, add these repo files as NotebookLM sources so the AI has ground truth:

- `README.md` — what it is, how to run it, the API
- `CONTEXT.md` — the domain language (the exact vocabulary to use on slides)
- `project-idea.txt` — the vision and the 5 engineering principles
- `docs/ROADMAP.md` — what's built vs. what's left (the "313 tests / 35 ADRs" status)
- `config/horizon.yaml` — the real, configured sources and limits
- (Optional, for depth) `docs/adr/0008`, `0014`, `0017`, `0022`, `0023`

> If NotebookLM can only take one source, use `README.md` + `CONTEXT.md`.

---

## STEP 1 — Paste this MASTER PROMPT into the presentation generator

> **Create a 15-slide executive presentation titled "Project Horizon — Your Autonomous Executive Editor."**
>
> **Audience:** an Operations Director (non-engineer, decision-maker). They care about _what it does_, _why it's reliable_, _what it costs to run_, and _what's next_ — not low-level code.
>
> **Goal:** make this the most impressive, credible, and professional deck possible. It must look like a polished product/investor briefing, not a student project.
>
> **Tone:** confident, precise, executive. Short, punchy lines. No filler. Use the project's real vocabulary (Story, Significance, Tick, Topic, Why-It-Matters, corroboration). Lead with outcomes, support with proof.
>
> **Design:** clean and modern. Dark, premium theme with a single accent color (deep blue or teal). One idea per slide. Big headline + 3–5 tight bullets max. Use simple diagrams/icons over walls of text. Every slide must have a 1-line "takeaway" the audience remembers.
>
> **Hard rules:** Use only facts from the loaded sources — never invent numbers, customers, or results. Keep claims honest: it is a complete, fully-tested product, **deployed live** (Render + Turso) and **fully observable** (a `/dashboard` over persisted tick reports). Use the exact figures: **23 sources (18 Story + 5 numeric Signal sources)**, **4 source-trust tiers**, **Significance 0.0–10.0**, **313 passing tests**, **35 architecture decision records (ADRs)**, ticks **every 15 minutes**.
>
> Build the slides exactly per the slide-by-slide outline I provide below.

---

## STEP 2 — Slide-by-slide outline (give this to the generator verbatim)

**Slide 1 — Title**

- Title: **Project Horizon**
- Subtitle: _Turns the world's public data into personalized news — sized to the time you have and the topics you care about._
- Footer line: "Built grill → architecture → TDD · 313 tests · 35 ADRs"
- Takeaway: one personalized, time-aware news brief from the whole world's public data.

**Slide 2 — The Problem**

- Headline: **News is fragmented, biased, and never fits your day.**
- Bullets:
  - **Scattered:** you hop between many news sites and channels instead of one personalized place.
  - **Biased:** many outlets lean toward one political direction, so you get a slanted picture.
  - **Wrong timing:** the news is served on the outlet's schedule, not yours — sometimes you have 2 minutes, sometimes 20.
  - **No sense of scale:** you can't tell how big a story you _are_ seeing really is, or whether bigger problems are going under-reported.
- Takeaway: the real problem isn't access to news — it's that nothing tailors it to _you_.

**Slide 3 — The Solution**

- Headline: **One unbiased brief, sized to your time — from the whole world's public data.**
- Body: Horizon is an autonomous background "editor." Every 15 minutes it pulls from official public APIs, scores how important each story objectively is, merges duplicates across sources and time, and writes a short "why it matters." You get **one place** instead of many; an **objective 0–10 significance score + multi-source corroboration** instead of one outlet's slant; a brief **budgeted to your available minutes**; and a true **sense of scale** that surfaces big-but-under-covered stories — delivered instantly from a pre-digested cache.
- Map each problem → fix (show as 4 paired rows):
  - Scattered → **One personalized feed** across 23 sources.
  - Biased → **Objective significance + corroboration** wash out single-outlet slant.
  - Wrong timing → **Time-budgeted** to 3, 10, or 20 minutes — your call.
  - No sense of scale → **A 0–10 score** that ranks true importance, not loudness.
- Takeaway: it fixes every problem on the previous slide, point for point.

**Slide 4 — How It Works (the Tick pipeline)**

- Headline: **One automated loop, nine disciplined steps — every 15 minutes.**
- Show as a horizontal flow diagram with a one-line gloss under each step:
  - **Extract** — pull fresh items from every healthy source.
  - **Persist** — save the raw item once, immutably (provenance).
  - **Classify** — tag each item with a Topic (Israel is a Topic, not a separate axis).
  - **Embed** — turn the text into a numeric "meaning" vector.
  - **Cluster** — group items that describe the same event.
  - **Resolve** — match against earlier stories so a developing story keeps growing.
  - **Score** — compute the 0–10 significance from verifiable signals.
  - **Analyze** — write "why it matters" for the top stories.
  - **Publish** — write the finished story to the read-only cache.
- Caption: Fully automatic. If a source or step fails, the loop logs it and keeps going.
- Takeaway: a repeatable, self-correcting assembly line for intelligence.

**Slide 5 — How You Ask For It (Telegram, in your words)**

- Headline: **You set the time and the format. It does the rest.**
- Bullets:
  - **How much time:** `/brief 3` for a fast 3-minute read, or more when you have it — the brief is budgeted to fit.
  - **How you want it:** `/brief` (text bullets), `/outline AI` (a topic deep-dive), or `/podcast 1` (narrated audio you can listen to).
  - **What you care about:** `/prefs topics AI,Geopolitics` and plain-English `/feedback more AI, less sports, shorter`.
  - Everything is answered instantly from the pre-digested cache — no waiting on live fetches.
- Takeaway: the user just states their time, format, and interests — in plain language.

**Slide 6 — Where the Data Comes From**

- Headline: **23 official sources. Zero scraping.**
- Bullets:
  - **The sources:** Hacker News, arXiv, GDELT, Knesset (bills + votes), SEC EDGAR, Wikipedia, The Guardian, Times of Israel, Hugging Face Papers, NBER, Nature, PsyArXiv.
  - Spanning tech/AI, science, world news, Israeli politics, and finance.
  - Strictly official, public, stable APIs — never fragile website scraping.
- Takeaway: trustworthy inputs, built to last.

**Slide 7 — Not All Sources Are Equal (Trust Tiers)**

- Headline: **The more objective the source, the more it counts.**
- Intro line: Every source is graded into one of four trust tiers (top = most trusted). The grade sets how much weight its data carries when scoring a story.
- Show 4 tiers as a pyramid, each with a plain-language meaning + example:
  - **Tier A — Official record _(most trusted)_:** the source _publishes the fact itself_ — official bodies, regulators, scientific journals. _e.g. SEC filings, Knesset, World Bank, Nature._
  - **Tier B — Neutral measurement:** takes no side; reports objective numbers _about_ the news — how often something is mentioned and in what tone. _e.g. GDELT mention counts._
  - **Tier C — Popularity:** shows what people click and upvote — public interest, not truth; counted only as a "what's trending" hint. _e.g. Hacker News, Reddit, GitHub._
  - **Tier D — Editorial outlets _(least trusted)_:** clean headlines, but each outlet _chooses_ what to cover and how to angle it — this is where political bias lives. Counted only when several independent outlets confirm the same story (corroboration). _e.g. The Guardian, Times of Israel._
- Takeaway: a built-in bias filter — the loudest outlet never outranks the most verified fact.

**Slide 8 — How "Significance" Is Decided**

- Headline: **A 0–10 score you can actually trust — impact first.**
- Bullets:
  - Driven by **real-world impact** (how many people are affected, how severely), **multi-source corroboration**, and **source authority** — a strong story on any of these rises to the top.
  - **Popularity is only a small booster**, never the driver — a 1,400-death earthquake outranks a viral tech post, not the other way around.
  - Every score is **broken down and shown** ("Why this score?") — explainable and reproducible, not a black box.
- Takeaway: importance, not loudness — and you can see the math.

**Slide 9 — It Connects the Dots Over Time**

- Headline: **One event, not ten duplicates.**
- Body: When the same story shows up across different sources and across hours, Horizon recognizes it, merges it, and _raises_ its importance as more outlets confirm it (corroboration). The same story grows; it doesn't clutter.
- How (short technical note): each story's text is turned into an **embedding** — a list of numbers that captures its _meaning_. Two stories about the same event land close together, so we measure closeness with **cosine similarity**. That's why simple keyword matching isn't enough: embeddings catch the same event even when it's worded completely differently, across sources and across ticks — then the AI confirms the merge.
- Takeaway: clarity that compounds, not noise that piles up.

**Slide 10 — What the User Gets (Delivery)**

- Headline: **Your intelligence, on your terms.**
- Three columns:
  - **Text brief** — "Give me 3 minutes." Time-budgeted bullets.
  - **Topic outline** — deep-dive on AI, Geopolitics, etc., ordered by significance.
  - **Audio podcast** — a narrated script, delivered as real audio.
- Two surfaces: a **web viewer / JSON API** and a **Telegram bot**.
- Takeaway: same brain, multiple front doors.

**Slide 11 — Personalized, In Plain English**

- Headline: **"More AI, less sports, keep it shorter."**
- Bullets:
  - Users tune their own feed with natural-language `/feedback`.
  - The AI reads the intent; deterministic code does the math.
  - Personal weighting changes _your_ ordering only; it never alters the objective score.
- Takeaway: personalization without compromising objectivity.

**Slide 12 — Safe & Cost-Controlled (Operations view)**

- Headline: **Predictable cost. Locked-down access.**
- Bullets:
  - **Default-deny access** on the bot; explicit allow-list required.
  - **Rate limits + daily quotas on every action** — per-user burst caps, per-user daily caps on _all_ commands, plus a hard process-wide ceiling — so usage and spend stay bounded.
  - **Tiered AI:** a cheap model does the high-volume work; the expensive model only touches the top ~10 stories.
  - Localhost-bound by default, request timeouts, response-size caps, owner-only database file.
- Takeaway: it's engineered to be cheap to run and hard to abuse.

**Slide 13 — Engineering Credibility**

- Headline: **Quality you can audit.**
- Bullets:
  - **310 automated tests, all green.** Every component proven in isolation.
  - **34 Architecture Decision Records** — every major choice documented with trade-offs.
  - Clean "seam" architecture: any source, AI model, or database can be swapped without rewrites.
  - Stack: TypeScript/Node, SQLite (or hosted Turso), OpenAI tiers, all behind tested interfaces.
- Takeaway: this is built like a product, not a prototype.

**Slide 14 — Where We Are Today (Status)**

- Headline: **The full MVP is built and tested.**
- Bullets:
  - ✅ **23 sources** wired in (18 Story + 5 numeric Signal).
  - ✅ **Full reasoning loop** — extract → classify → embed → cluster → resolve → score → analyze → publish.
  - ✅ **Both delivery surfaces** — web viewer / API and the Telegram bot (text, outline, audio podcast).
  - ✅ **Security & cost hardening** — access control, quotas, resilient fallbacks.
- Takeaway: this isn't a concept — it runs end-to-end today.

**Slide 15 — What's Next (Roadmap)**

- Headline: **From MVP to a richer, self-improving product.**
- Bullets:
  - **Broaden coverage** — add more online sources to support more interest fields.
  - **improve scoring** — break down and improve how we calculate relevance, popularity, and reliability.
  - **Self-improving feedback** — a feedback loop that automatically gets better at tailoring future briefs.
  - **Social signals** — connect to Reddit, then deep-dive on integrating other social media.
  - _(Plus: deploy to a hosted URL + observability.)_
- Closing line: **"The engine is built. Next we widen the inputs and make it smarter every cycle."**
- Takeaway: low remaining risk, clear path to a deeper, self-improving product.

---

## STEP 3 — Design & polish checklist (tell the generator to enforce)

- One headline + max 5 bullets per slide. If it needs more, split it.
- Every slide ends with its 1-line **Takeaway** in the accent color.
- Prefer diagrams/icons: a problem→fix pairing (Slide 3), a pipeline flow (Slide 4), a trust pyramid (Slide 7), 3 columns (Slide 10).
- Consistent dark premium theme, one accent color, generous whitespace, large type.
- Use the project's real words exactly — Story, Significance, Tick, Topic, Why-It-Matters, corroboration.
- No clip-art, no emoji on slides, no jargon the Operations Director won't know without a 1-line gloss.

## STEP 4 — Speaker notes (ask the generator to add these per slide)

For each slide, add 2–3 sentences of speaker notes that:

1. State the single point in plain language.
2. Give one concrete example (e.g., "an earthquake reported by USGS, then confirmed by GDELT and Wikipedia, climbs in significance automatically").
3. End with a transition line into the next slide.

---

## One-paragraph elevator pitch (use as the deck description / intro)

> Project Horizon is an autonomous, server-side "executive editor." Every 15 minutes it pulls
> from 23 official public data sources, scores each story's real-world significance on a
> transparent 0–10 scale, de-duplicates and connects related events over time, and writes a
> short "why it matters" for the most important ones — all in the background. Users then ask
> for exactly what they want — a 3-minute text brief, a topic deep-dive, or a narrated audio
> podcast — and get it instantly from a pre-digested cache, via web or Telegram. It's built to
> degrade gracefully, run cheaply, and stay objective, backed by 313 passing tests and 35
> documented architecture decisions.
