# ADR-0024: Readability floor in attention budgeting

- **Status:** Accepted
- **Date:** 2026-06-17
- **Amends:** ADR-0013 (attention & time budgeting).

## Context

ADR-0013's `budgetStories` is a breadth-first inverted pyramid: it admits Stories at the
cheapest depth (`headline`) until the word budget is full, then spends any leftover deepening
the top Stories. At small budgets this starves depth — `/brief 1` (≈220 words ÷ 18) admitted
~12 headline-only bullets and had ~4 words left, so nothing was upgraded. Since a `headline`
render is the title alone (no `whyItMatters`), the user got a dozen context-free headlines
("GLM 5.2 Is Out") that were unreadable. The product wants the opposite: **fewer Stories,
each fully explained, regardless of the requested minutes.**

## Decision

Make the unit of inclusion a *fully-rendered* Story, not a headline, via two tunables on the
budget params (config-driven, `presentation.minDepth` / `presentation.minStories`):

- **`minDepth`** (default `full`) — no Story is admitted below this depth, so every Story
  shown carries real context (`full` ⇒ its complete "why it matters").
- **`minStories`** (default `3`) — always admit at least this many (if available), even if it
  slightly exceeds the word budget. Readability beats minute-precision at tiny budgets.

The kernel becomes: admit ranked Stories at `minDepth` while they fit (forcing the first
`minStories`), then deepen top-heavy toward `full` with any leftover (a no-op when the floor
is already `full`). Minutes still scale the count *up* above the floor; they can no longer
starve depth *down*. The most-significant Stories are exactly the ones the deep tier analysed
(top-N by Significance, ADR-0006), so the few shown reliably have a `whyItMatters` to render.

`minDepth: headline, minStories: 0` recovers the original ADR-0013 pyramid, so the kernel
stays general; the floor is a configured policy, not a hard-coded one.

## Consequences

- `/brief 1` now yields ~3 fully-explained Stories instead of ~12 headlines.
- The floor applies to every format (brief, outline, podcast) through the shared kernel.
- A Story without a `whyItMatters` (outside top-N, or a degraded analyze) still renders as a
  headline at `full` depth — acceptable as a transient; pursue "prefer-explained selection"
  only if it shows up in practice.
- **Large-minute briefs are now bounded:** `presentation.maxStories` (default 12) caps the
  selection (the cap wins over `minStories`), and `BotApiTransport.sendMessage` splits any text
  over Telegram's 4096-char limit into ordered chunks on line boundaries — so a long brief is
  delivered as multiple messages rather than failing.

## Alternatives considered

- **Just raise `deepAnalysisTopN`** — more Stories get a `whyItMatters`, but doesn't stop the
  budget from admitting headline-only bullets at small budgets, and costs more Opus per tick.
- **Generate context on demand in the read path** — would make briefs readable but reintroduces
  LLM latency/cost on every read, violating the read-only-cache spirit (Principle 4).
- **Keep breadth-first, raise `wordsPerMinute`** — a tuning hack that shifts the threshold
  without fixing the starvation; still degenerates at small budgets.
