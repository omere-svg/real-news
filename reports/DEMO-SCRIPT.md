# Project Horizon — 3-minute demo script + judge one-pager

## The one-line pitch (open with this)
> An AI autonomous editor that reads across 21 official news & data sources every few
> minutes and hands you all your news — every field you follow — in one objective place:
> each story scored 0–10 by transparent math you can open and inspect, de-duplicated
> across outlets and time, sized to the minutes you have, and delivered as text or audio
> — on a web app and a Telegram bot you log into with no password.

## The 3-minute path (rehearse on a warm cache — never demo within ~20 min of a wipe)

**0:00 — The problem (10s).** "Every news app either floods you or summarizes with a
black-box LLM you can't trust. Horizon does neither."

**0:10 — Open `/` (30s).** The hero explains it in one line. Point at the how-it-works
strip: **"21 official sources, zero scraping, updated N minutes ago"** — this is a live
autonomous worker, not a static page. Point at the **Editor's note** at the top:
*"N new stories entered the front page in the last update"* — the system tells you what
it just changed.

**0:40 — The differentiator: transparent scoring (50s).** The top story's **"Why this
score?"** is already open — labeled bars for impact, corroboration, authority,
attention, plus recency. Say: *"Every score is math, not a vibe. Impact-first: a
1,400-death earthquake outranks a popular tech post, and you can see exactly why."*
The always-visible tags ("major real-world impact · 3 sources · official source") make
it scannable. This is the moat vs every "LLM summarizes the news" entry. Point at the
**source-link pill** on the card: *"and every story links back to the original outlet —
read it in full, and check the summary is faithful."*

**1:30 — Sized to your time (25s).** Switch to **Brief**, drag the time slider from 1
to 5 minutes — the brief grows from a few headlines to fuller stories with why-it-matters,
rendered as clean cards. "Same cache, budgeted to the attention you have."

**1:55 — The second surface (35s).** On Telegram: type *"what's new in AI?"* — plain
English routes to the right action, grounded only in the cache. Then *"make me a
2-minute podcast"* → narrated audio. Then `/subscribe 08:00` — a scheduled daily brief,
the bot working for you while you sleep. "One cache, two surfaces, and you logged in
with Telegram — no password, no email, no PII."

**2:30 — The engineering story (30s).** Open `/dashboard`: live tick health, throughput,
and LLM **reflection advisories**. Three receipts worth flashing: `/api/stats` — real
subscriber + questions-answered counts, not zeros, plus multi-source/cross-tick
accumulation; `/api/chat-traces` — open one trajectory and point at **step 0**, the agent's
own recorded plan before it calls a tool (ask the bot a question first if the list is empty);
and a single-source story's "Why this score?" — no misleading 0% corroboration bar, it's
just omitted for a lone source. Then the closer: *"This is built on 66 ADRs and strict
TDD — run `npm test` yourself, the count is the proof. I ran QA cycles against the live
database that found and fixed a stored XSS, a data-loss race, a poll busy-loop, and
sources silently serving years-old data — each is a documented ADR. It engineers like a
team, not a hackathon."*

## Judge one-pager (hand out / slide)

**What it is:** an AI autonomous, server-side executive editor. A background worker pulls
21 official public sources every ~20 min, scores + de-duplicates + explains stories into a
local DB, served zero-latency on a web viewer and a Telegram bot — all your fields in one
objective place, sized to your time, as text or audio.

**Why it wins:**
1. **Transparent, reproducible scoring** — a persisted per-component `ScoreBreakdown`
   surfaced verbatim ("Why this score?"). Not a black box.
2. **Engineering rigor** — 66 ADRs (grill → architecture → TDD), a 749-test suite
   (`npm test` is the living count; 96.3% line / 85.83% branch coverage, CI-gated at
   90/80), and real production-DB QA cycles
   (ADR-0047/0048/0049) that found + fixed live defects.
3. **Autonomy & resilience** — self-healing backfill, self-observing dashboard +
   reflection advisor, per-source failure isolation, graceful no-API-key degradation,
   a cross-process tick lock, and per-user + global cost quotas that make open access safe.
4. **Zero-scraping, official-API-only** — a clean objectivity/legality story.
5. **Frictionless dual surface** — log in with Telegram (no password/email/PII); prefs
   sync between web and bot.

**Honest framing:** a rigorously-engineered autonomous *agent* whose distinguishing
virtue is inspectable, reproducible judgment — not a horizontally-scaled SaaS (it's
deliberately one writer per DB).

**Numbers (verify live, don't trust this page):** 27 sources (21 active Story feeds + 6
numeric Signal sources; knesset-votes disabled upstream) · Significance 0.0–10.0 ·
tests: run `npm test` — the printed count (749 green + 2 env-gated live at last edit) is
the proof · ADRs: `ls docs/adr | wc -l` prints 66 — 65 numbered + the template · live
accumulation counts: `/api/stats` · ticks every ~20 min · deployed on an Oracle Cloud VM
+ Turso.

## Demo safety checklist
- [ ] Cache is warm (let ≥1 tick complete after any wipe; the viewer shows empty states cold).
- [ ] `/health` returns ok and `/api/ticks` shows a recent OK tick.
- [ ] Telegram bot reachable (it long-polls; works even if web is briefly down).
- [ ] Pick a story with a high impact score for the "Why this score?" moment.
- [ ] Have `/dashboard` and one ADR (0049) open in tabs for the engineering close.
