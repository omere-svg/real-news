# ADR-0034: Impact-first Significance (scoring redesign)

- **Status:** Accepted — implemented 2026-06-29.
- **Date:** 2026-06-29
- **Deciders:** Project Horizon team
- **Supersedes the scoring model of:** ADR-0008 (hybrid significance). Keeps its
  principle (deterministic, inspectable) but changes the formula and the
  editorial term.
- **Extends:** ADR-0032 (score breakdown), ADR-0025 (Signal nudge).

## Context

Real output exposed the old model as miscalibrated for "macro-significance":

- A **1,400-death earthquake** (Guardian) scored **2.8**, *below* a Hacker-News
  post "GLM 5.2 beats Claude" at **5.2**. The editor was ranking upvotes over a
  mass-casualty disaster.
- **Every** score sat around 4–6; nothing approached 10.

Root causes in `computeBaseScore` (ADR-0008):
1. **45% of the weight was social popularity** (`popularity 0.3 + engagement 0.15`)
   that only Hacker News / GitHub / HF expose. Official wires and disaster feeds
   (Guardian, USGS, WHO) send no points/comments, so ~half their score was zero
   before they started.
2. **A weighted average of normalized signals can't reach 1.0** — you'd need every
   component maxed at once — so scores compressed into the mid-range.
3. **Recency multiplied the whole score** with a 24-h half-life, so a 2-day-old
   ongoing disaster was cut to ¼ regardless of its importance.
4. **Magnitude rode the HN-points scale** (`POINTS_REF = 500`), so a M6 quake read
   as popularity ≈ 0.3 — real-world severity was invisible to the math.
5. The model had **no way to read human impact** from prose ("1,400 dead"); the
   only term that could was a vague editorial ±nudge capped at ±1.5.

## Decision

Make Significance **impact- and authority-first**, with attention as a booster
that never penalizes its absence, and use the full 0–10 range.

**Components** (each normalized to [0, 1]):
- `impact` — real-world consequence (casualties, disaster scale, major economic /
  geopolitical stakes). Read from the text by the Reasoner's **cheap tier**
  (`assessImpact`, runs on every cluster) — an *inspectable extracted input*, not a
  black-box rating. Replaces the old freeform editorial ±nudge entirely.
- `corroboration` — distinct corroborating Sources (unchanged signal).
- `authority` — the strongest contributing Source's weight (Tier A/B > C/D).
- `attention` — social popularity (`max(points, mentions)` normalized). **Booster only.**

**Aggregation** — a **noisy-OR** of the importance axes so a story strong on *any*
serious axis approaches the top, plus a bounded attention add-on:

```
importance = 1 − (1 − impact·1.00)(1 − corroboration·0.90)(1 − authority·0.55)
quality    = clamp01(importance + 0.15 · attention)
base       = 10 · quality · recency
```

**Recency is gentled** so a major ongoing event isn't erased by age: a floor keeps
at least half the score, with a longer default half-life:

```
recency = RECENCY_FLOOR + (1 − RECENCY_FLOOR) · 0.5^(ageHours / halfLife)   // floor 0.5, halfLife 36h
```

The bounded numeric-Signal nudge (ADR-0025) stays as a small additive post-term.
The old `maxEditorialAdjustment` term is removed (its job is now the structured
`impact` axis).

**Source weights** are realigned to the trust tiers (ADR-0008 §2): the engagement
platforms (Hacker News, HF Papers) are dropped to Tier-C weights so their
popularity feeds `attention`, not `authority`.

**The breakdown + rationale tags** (ADR-0032) are rebuilt on the new components:
the web "Why this score?" lists impact / corroboration / authority / attention, and
the brief's one-line tail names the *true* drivers (e.g. `· major real-world impact ·
3 sources · official source`) instead of the old social-only, non-discriminating
labels (the blanket "high attention" — a per-*topic* nudge shown on every story — is
dropped).

## Consequences

- The earthquake now ranks **above** the benchmark post; catastrophic, authoritative,
  or widely-corroborated stories reach 8–10; lone low-impact items stay low.
- Scores **use the whole 0–10 range**.
- `assessImpact` adds one cheap-tier call per cluster (the old `adjustSignificance`
  did too — net cost unchanged); it degrades to `impact = 0` under outage, leaving
  the deterministic axes intact.
- **Trade-offs:** `impact` is model-estimated, so it's editorial — but it is a single
  inspectable [0,1] input shown in the breakdown, not a hidden final score, and it
  cannot by itself exceed what corroboration/authority/recency allow.
- **Deferred:** structured severity from source metadata (USGS magnitude, GDACS alert
  level) on its own scale, and better clustering so same-event articles merge and
  raise corroboration — both noted as follow-ups.

## Alternatives considered

- **Just rescale the old formula.** Rejected: keeps popularity at 45% and the
  earthquake below the benchmark.
- **Widen the editorial ±nudge.** Rejected: a larger freeform nudge is *less*
  inspectable than a structured `impact` axis and erodes the "math is the backbone"
  principle.
- **Weighted average, re-weighted.** Rejected: still can't reach 10 and still zeroes
  out sources that lack a given signal; noisy-OR fixes both.
