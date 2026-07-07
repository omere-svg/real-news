# Evidence index — Project Horizon

Curated, highest-value proof. Everything here is reproducible from a clean clone;
the live URLs prove it runs unattended.

## Demonstrated (run it / hit it)
- **The test suite — strongest evidence.** From the repo root:
  ```
  npm install
  npm test           # the printed count is the proof (582 green, ~3s, real migrations)
  npm run typecheck  # clean
  npm run verify:bot # drives the real Telegram bot end-to-end
  ```
  Worth opening: `test/llm/reasoner-injection.test.ts` (adversarial payloads through
  every prompt), `test/telegram/chat-agent.test.ts` (scripted multi-step tool
  trajectories), `test/pipeline/reflection-policy.test.ts` (the model-proposes /
  guard-disposes screen), `test/pipeline/resolve.test.ts` (cross-outlet merges).
- **Live URLs (public, no login needed to read):**
  - Viewer: https://horizon-news.duckdns.org — ranked 0–10 stories, "Why this
    score?" breakdowns, time slider, editor's note.
  - Ops: https://horizon-news.duckdns.org/dashboard — autonomous tick health,
    reflections **and the actions they imposed**, accumulation stats.
  - Agent receipts: https://horizon-news.duckdns.org/api/chat-traces — the chat
    agent's tool trajectories, per answer.
  - Accumulation: https://horizon-news.duckdns.org/api/stats — stories,
    multi-source merges, cross-tick developments, signal-history depth, today's
    per-tier token spend.
  - Raw run log: https://horizon-news.duckdns.org/api/ticks
- **Try the agent:** https://t.me/OmerNewsBot — ask "why did markets drop?", then
  open `/api/chat-traces` and watch how it answered. `/subscribe 08:00` for the
  scheduled brief.
- **Cross-outlet corroboration, judge-runnable:**
  ```
  curl -s "https://horizon-news.duckdns.org/api/stories?limit=100" \
    | jq '[.stories[] | select(.scoreBreakdown.signals.corroboration > 1)
           | {title, sources: (.memberRefs | map(.source))}]'
  ```
- If your DNS resolver is stale on duckdns, add:
  `--resolve horizon-news.duckdns.org:443:$(dig +short horizon-news.duckdns.org @8.8.8.8 | tail -1)`

## Present (code to read)
- **Repo:** https://github.com/omere-svg/real-news (public; secrets stripped —
  only `.env.example` is committed).
- Key files:
  - `src/telegram/chat-agent.ts` — the model-driven tool loop (the chat agent).
  - `src/pipeline/reflection-policy.ts` — reflection→action, screened + clamped.
  - `src/pipeline/adaptive-backoff.ts` — observe→adapt, rehydrated across deploys.
  - `src/llm/fence.ts` + `src/llm/reasoner.ts` — universal injection fencing.
  - `src/telegram/quota-guard.ts` — per-chat + global cost caps.
  - `src/presentation/score-explanation.ts` — the transparent scoring seam.
  - `docs/adr/` — 54 architecture decision records.
- **Depth artifacts (`reports/` in the repo):** `DEMO-SCRIPT.md` (3-minute path),
  `CODE-REVIEW.md`, `CYCLE-CHANGES.md` (what each QA cycle found and fixed).

## A note on live numbers
The production DB restarts fresh when a hardening pass ships (the fixed code's
output is the exhibit). `/api/stats` counts accumulate from that day forward —
signal history and corroboration timing are time-series data that cannot be
backfilled, which is exactly the moat claim: watch them grow.
