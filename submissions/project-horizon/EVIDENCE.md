# Evidence index — Project Horizon

Curated, highest-value proof (lead with the runnable test + the live URL).

## Demonstrated (run it / hit it)
- **Test suite — the strongest evidence.** From the repo root:
  ```
  npm install
  npm test          # 460 tests across 72 files, all green
  npm run typecheck # clean
  npm run verify:bot # drives the real Telegram bot end-to-end (real OpenAI TTS)
  ```
- **Live URL (public, no login needed to read):**
  - Viewer: https://horizon-news.duckdns.org — ranked 0–10 stories, always-visible
    score tags, one-tap "Why this score?" breakdown, time-budget slider, and the
    "what changed since last update" editor's note.
  - Ops dashboard: https://horizon-news.duckdns.org/dashboard — live autonomous tick
    health, throughput, failing sources, and LLM reflection advisories.
  - Raw run log: https://horizon-news.duckdns.org/api/ticks

## Present (code to read)
- **Repo:** https://github.com/omere-svg/real-news (public; secrets stripped —
  `.env` git-ignored, only `.env.example` committed).
- Key files:
  - `src/pipeline/tick-runner.ts` — the autonomous plan→act→observe loop.
  - `src/pipeline/adaptive-backoff.ts` — observe→adapt (failing-source backoff).
  - `src/llm/reasoner.ts` — prompt-injection fencing (`asData`).
  - `src/telegram/quota-guard.ts` — per-chat + global cost caps.
  - `src/presentation/score-explanation.ts` — the transparent scoring seam.
  - `docs/adr/` — 52 architecture decision records.
- **Depth artifacts (in the repo `reports/`):** `DEMO-SCRIPT.md` (3-minute path),
  `CODE-REVIEW.md` (verified review), `CYCLE-CHANGES.md` (what each QA cycle fixed),
  `SCORING-PLAN.md` (this pass's plan).

## Note on the repo copy
The public GitHub repo IS the evidence — clone it rather than trusting a snapshot.
Everything above is reproducible from a clean clone; the live URL proves it runs.
