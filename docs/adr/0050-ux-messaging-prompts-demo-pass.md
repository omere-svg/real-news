# ADR-0050: UX, messaging, prompt, and demo-readiness pass

- **Status:** Accepted — implemented 2026-07-07.
- **Date:** 2026-07-07
- **Extends:** ADR-0011/0014 (presentation), ADR-0024 (readability), ADR-0032/0037
  (score explanation), ADR-0006/0016 (Reasoner), ADR-0022 (quotas), ADR-0040 (web auth).

## Context

With the pipeline hardened over cycles 1-2 (ADR-0047/0048/0049), the gap to a
competition-winning entry was **legibility, not engineering** (see
`reports/NEXT-STEPS.md`): the transparent-scoring differentiator was hidden behind
a click, brief/outline/podcast rendered as a monospace blob, the rich backend was
invisible from the UI, bot messages under-explained the product, and the
generation prompts were long and loosely specified. This pass addresses UX,
messaging, prompt quality, and the selected NEXT-STEPS items.

## Decision

**Prompts** (grounded in research — OpenAI GPT-4.1 prompting guide + "lost in the
middle", TACL 2024; see `reports/UPGRADE-PLAN.md`): keep instruction blocks short
and precise, structured role → task → explicit output format → one tiny example →
**fenced source data last**; low `temperature` on the generation paths for
formatting consistency.
- `analyze` (feeds brief + deep-dive): tightened, format-locked with an example,
  feed text fenced as `<item>` data, temperature 0.3.
- `narrate` (podcast): anchor persona; spoken-audio rules (no markdown/symbols/URLs,
  spell out numbers/acronyms, short sentences, spoken transitions); brief fenced.
- `assessImpact` / `confirmSameStory`: feed text fenced as data.
- The fencing (`asData`) doubles as the **prompt-injection guard** (NEXT P2#6): a
  crafted headline can't be read as an instruction.
- `CompletionOptions.temperature` added to the transport seam.

**Web UI/UX:**
- Brief/outline render as the same story cards as the Stories tab (parsed from the
  deterministic render), podcast as readable prose — no more `<pre>` blob.
- Score rationale tags are always-visible on every card (server-computed via the
  single `scoreExplanation`, returned on `/api/stories` as `scoreTags`); the top
  story's full "Why this score?" breakdown auto-opens.
- The how-it-works strip states "20+ official APIs · zero scraping" + a live
  freshness stat from `/api/ticks`.
- A **"what changed since last update" editor's note** at the top of Stories
  (new entrants since the latest tick, computed client-side from `firstSeenAt` —
  no new endpoint), surfacing the autonomy story.

**Messaging:** bot HELP leads with what it does, each with a plain-English example
+ its slash alias, ending in tap buttons; limit/error messages say when they reset
and what's still free; the unknown-topic reply names the next action.

**Selected NEXT-STEPS:** web podcast enabled (script-only, bounded by
`maxPodcastMinutes`; a global web cap is a documented follow-up); session +
rate-limiter Maps evict idle/expired entries so open access can't grow them
without bound; server + viewer-render surface tests added; stale doc figures
corrected. Deliberately **not** done: pre-seed a warm demo DB; Priority-3 features
other than the editor's note.

## Consequences

- The differentiator (transparent scoring) and the backend (sources, freshness,
  autonomy) are now visible in the first screen — the judge sees in seconds what
  the ADR trail earned.
- Generation output is shorter, cleaner, and injection-resistant.
- Web podcast is a cost vector without a per-user cap (documented; demo-safe by
  the minute cap, needs a global cap before long-term public exposure).
- A true headless-browser viewer test is still deferred (would add a heavy dep);
  covered for now by server-render assertions + the verified parse logic.
