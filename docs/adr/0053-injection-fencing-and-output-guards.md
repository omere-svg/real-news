# ADR-0053: Universal injection fencing and output-side guards

- **Status:** Accepted — implemented 2026-07-07.
- **Date:** 2026-07-07
- **Extends:** ADR-0050 (first fencing pass), ADR-0016 (Reasoner owns prompts),
  ADR-0047 (null-preserving analysis upsert).

## Context

A per-dimension judge review found the ADR-0050 fencing partial: `classify`
interpolated raw feed text; the entire chat path (question, history, memory,
cached stories, and — the classic indirect vector — live Tavily web snippets)
was unfenced; so were the three bot NLU prompts and the reflection tick digest.
The fence itself was a convention: a headline containing a literal `</item>`
would close the block and break out. And nothing checked the model's *output*
for signs the input had steered it.

## Decision

1. **Every prompt that receives untrusted text fences it** with `asData` —
   feed titles/bodies (classify, confirmSameStory, assessImpact, analyze,
   narrate), user text (routeIntent, interpretPrefs, interpretFeedback,
   discuss question), conversation history, reader memory, cached story
   context, web snippets (`<web_results>`, with a named explicit warning),
   and the reflection digest (its error strings come from upstream feeds).
2. **`asData` escapes `<`** (→ `‹`) inside the block, so a crafted closing tag
   cannot terminate the fence — mechanism, not convention.
3. **Output guards:**
   - `discuss`: URLs not present in the grounding material (cache stories /
     web results) are stripped from the answer — a poisoned snippet cannot
     make Horizon relay an attacker link. Answers are length-capped.
   - `analyze`: a summary/whyItMatters carrying a URL or an injected
     imperative ("ignore previous…", "click here", "api key") is rejected to
     `null`; the null-preserving upsert (ADR-0047) keeps any prior good value.
4. **Config truth:** `web.secureCookie: true` (prod is HTTPS; the env override
   is now two-way so local plain-http dev sets `WEB_SECURE_COOKIE=false`);
   the stale "web podcast has no cap" comment replaced with the actual shared
   global budget (ADR-0052).

## Consequences

- The blast radius of a successful injection was already bounded (no tools
  downstream of untrusted text; zod schemas, vocab whitelists, numeric
  clamps). It is now layered: fence → delimiter escape → schema/vocab/clamp →
  output guard.
- `test/llm/reasoner-injection.test.ts` pins the contract adversarially: the
  canonical payload through every Reasoner method must appear only inside a
  fence; a `</item>` breakout attempt yields exactly one well-formed fence;
  un-grounded URLs are stripped; steered editorial fields reject to null.
- Escaping `<` slightly alters fenced content the model sees (e.g. HTML in a
  feed body) — acceptable: fenced blocks are prose for judgment, not markup.
