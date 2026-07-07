# ADR-0059: Coverage sources (BBC + Ynet) and English-only story bodies

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

Two problems surfaced from live use of the deployed product:

1. **Coverage gaps.** Major real-world events were missing from the front page.
   The clearest example: the FIFA World Cup was underway — arguably the single
   most-followed event on earth — yet it barely appeared. Root cause: the only
   Sports source (`thesportsdb`) emits *match scores*, not sports *news*, and no
   mainstream outlet was corroborating the story into a high-significance cluster.
   The same shape hurt business (only SEC filings + academic NBER, no plain
   business news) and Israel (a single outlet, Times of Israel). A story that one
   source covers alone scores low on corroboration by design (ADR-0034), so a
   thinly-sourced topic stays invisible even when it matters enormously.
2. **Non-English bodies leaked to the UI.** A Chinese-sourced story rendered an
   English *headline* (`displayTitle`) but a Chinese *summary* and *why-it-matters*
   under it. The deep `analyze` prompt translated the title but never told the
   model to write the body in English, so a foreign-language source echoed its own
   language into the summary. And `needsAnalysis` only re-healed missing/foreign
   *titles*, never a foreign *body*, so such rows never self-corrected.

## Decision

- **Add three mainstream feeds via the existing generic `RssSource`** (one URL +
  optional Topic, the Guardian/Times-of-Israel pattern), plus a fourth aimed
  directly at the World Cup gap:
  - `bbc-world` — no hard-coded Topic (spans many, let the classifier converge
    same-event articles, like Guardian).
  - `bbc-business` — `Business` (real events to complement SEC/NBER).
  - `bbc-sport` — `Sports` (**the World Cup fix**: real sports news, where
    `thesportsdb` only has scores). Live check: the BBC Sport feed carried 30+
    "World Cup" items.
  - `ynetnews` — `Israel` (a second Israel outlet, distinct ownership from Times
    of Israel; its inline-HTML descriptions strip cleanly via the existing
    `stripHtml`→`decodeEntities` pipeline).
  All four are compiler-enforced through `STORY_SOURCE_IDS` → `buildSource`'s
  exhaustive switch → the config schema. Weights match media precedent (0.5, with
  BBC Business at 0.55).
- **The deep `analyze` prompt now requires English for every field**, explicitly:
  "write EVERY field in clear, natural English, even when the item is in another
  language." The title was already translated; this extends the guarantee to
  `summary` and `whyItMatters`.
- **The heal loop now detects a foreign-script body.** A new `hasNonLatinScript`
  test (CJK, Cyrillic, Hebrew, Arabic, Greek, …) gates a new `needsEnglishBody`,
  which `needsAnalysis` includes — so a stored non-English summary/why re-analyzes
  and comes back in English. Existing bad rows self-heal on the next boot backfill
  (`reasoner.backfillOnBoot`, most-significant first).

`hasNonLatinScript` is deliberately **script-based, not accent-based** (unlike
`looksNonEnglish`, used for one-line titles where a cheap translate harmlessly
cleans accented Latin). Re-analyzing a body is an *expensive* deep-tier call, so
an English sentence containing "Beyoncé", "café", or "Łódź" must not trigger an
endless re-heal — only genuinely foreign script does.

## Consequences

- The World Cup (and other mainstream events) now enter the cache with real
  sources and corroboration, so importance-first ranking can surface them. A
  single group-stage match still ranks below a war or disaster — by design — but
  it is no longer invisible.
- Every stored/rendered story body is English, and legacy foreign-body rows heal
  automatically after deploy rather than needing a manual DB scrub.
- Four new feeds add per-tick cost, bounded by each source's `maxItems: 20`.

## Alternatives considered

- **Raise `thesportsdb`'s weight** to surface sports. Rejected: scores aren't
  news; it would inflate low-value match results, not the World Cup *story*.
- **A DB migration to delete non-English rows.** Rejected: it discards real
  stories and doesn't stop recurrence. Fixing the prompt + heal keeps the content
  and prevents the bug returning.
- **Accent-sensitive body detection** (reuse `looksNonEnglish`). Rejected: it
  would re-run the deep tier forever on any English body naming a foreign person
  or place — real cost for no gain.
