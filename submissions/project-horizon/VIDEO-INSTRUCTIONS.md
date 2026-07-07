# Morning video — what to film (you record this yourself)

Target: **~3 minutes**, screen recording with your voice. Goal is to move claims
from "asserted" to "demonstrated." Show real live URLs and one real bot answer.
Don't over-produce it — one clean take beats polish.

Before you hit record (2 min of setup):
- Confirm the new build is live: open `https://horizon-news.duckdns.org/health`
  (should be OK) and `https://horizon-news.duckdns.org/api/stats` (numbers > 0).
- Have these tabs pre-opened: the viewer, `/dashboard`, `/api/chat-traces`,
  and the Telegram chat with `@OmerNewsBot`.

## The script (say roughly this, show exactly this)

**0:00–0:20 — What it is.**
"Project Horizon is an autonomous editor. It reads 21 official news and data
sources every ~20 minutes on its own, merges coverage of the same event across
outlets, and ranks stories by real-world impact — with the math shown."
→ Show the viewer homepage with the ranked brief already loaded.

**0:20–0:55 — The magic moment: transparent scoring.**
"Every rank is auditable." → Click one story's **"Why this score?"** to expand
the component bars. Read one line aloud, e.g. "major real-world impact, 3
sources, official source." → Drag the **time slider** from ~3 to ~15 minutes and
point out the brief grows and stays diverse (no duplicate event in two slots).

**0:55–1:40 — The agent (live).**
Switch to Telegram. Ask the bot a real question, e.g. **"why did markets drop?"**
→ Wait for the answer. Say: "That wasn't a canned reply — the model chose which
tools to call." → Switch to `https://horizon-news.duckdns.org/api/chat-traces`,
refresh, and show the newest trace: point at **step 0 (the plan)** and the
**tool calls** (search_stories, get_story, etc.) and the `path: "agent"` field.

**1:40–2:20 — Autonomy + self-tuning.**
Open `/dashboard`. Say: "It runs headless. Here's tick health, which sources ran
or were rested, and — when reflection fires — the actions it imposed on itself
and later auto-reverted after healthy ticks." → Point at the tick list / failing
sources / reflections section.

**2:20–2:50 — Safety & cost.**
Say (over `/api/stats`): "Every cost vector is capped — per-chat and global
daily quotas, plus a restart-safe daily spend ceiling on the pipeline. Untrusted
input from feeds, users, and the web is fenced as data, never executed, and URLs
in output are guarded. It takes no unattended high-harm actions — every write is
to its own reversible database." → Point at the per-tier token spend on
`/api/stats`.

**2:50–3:00 — Close.**
"It's live at horizon-news.duckdns.org, the bot is @OmerNewsBot, and the whole
suite — 740 tests plus live golden tests — is public on GitHub."

## Must-show checklist (these are the highest-scoring shots)
- [ ] "Why this score?" breakdown expanded on a real story.
- [ ] A real bot answer, then its trace at `/api/chat-traces` (plan + tool calls).
- [ ] `/dashboard` tick health / reflections.
- [ ] `/api/stats` with live numbers and token spend.

Full detailed path if you want more: `reports/DEMO-SCRIPT.md`.
After recording, put the file (or a link) here and update `proposal.md`'s
**Demo** field with the URL.
