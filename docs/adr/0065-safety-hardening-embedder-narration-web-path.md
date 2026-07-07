# ADR-0065: Safety hardening — degrade-aware embedder, spoken-URL guard, single web path

- **Status:** Accepted
- **Date:** 2026-07-07

## Context

A hardening pass surfaced three independent weaknesses across the pipeline, the
narration path, and the chat loop:

1. **Poisoned neural index.** When the OpenAI embedder fails, `ResilientEmbedder`
   falls back to the dependency-free `HashingEmbedder` so the tick doesn't crash
   (ADR-0018). Those hash vectors are internally consistent (fine for *this*
   tick's dedup blocking) but live in a completely different space than the
   persisted neural vectors. Persisting them silently poisons cross-tick merge
   and semantic search: a hash vector has near-zero, meaningless cosine against
   every real embedding.
2. **Unguarded spoken output.** `discuss`/chat answers strip ungrounded URLs
   (ADR-0053/0054), but `narrate` (podcast) had no output guard. Its input brief
   is assembled from third-party feed content, so a poisoned item could try to
   smuggle a spoken link — read aloud literally in the audio.
3. **Two web paths.** With the chat agent enabled, `web_search` is one of its
   budgeted, grounded, traced tools. But the fixed fallback discuss path *also*
   escalated to a deterministic web search — a second, ungoverned web-spend path
   that could fire behind the agent's back (no tool budget, no trajectory).

## Decision

**Close all three, each fail-safe.**

1. **Degrade-aware embedding.** The `Embedder` seam gains an optional
   `DegradeAwareEmbedder.embedBatch` returning `{ vectors, degraded }`.
   `ResilientEmbedder` sets `degraded: true` whenever it fell back. The `embed`
   stage threads the flag out (`EmbedResult`), and `TickRunner` **skips
   `putVector`** for a degraded batch. The stories still upsert and still cluster
   in-tick; they just keep whatever good vector a prior tick wrote instead of
   overwriting it with a hash vector.
2. **Spoken-script URL guard.** `narrate` output passes through `spokenScript`,
   which strips **every** URL (a spoken bulletin never contains one — no
   grounding exception, unlike `discuss` which renders clickable links) and caps
   the length. A poisoned brief can no longer put a link in the audio.
3. **Single web path.** The fixed discuss fallback only escalates to a web
   search when `agentTransport` is **not** wired. Once the agent loop exists —
   even on its degrade branch — web escalation is exclusively the agent's
   budgeted, traced tool. Cache-only otherwise.

## Consequences

- The neural index can never be silently corrupted by a fallback embedding; a
  degraded tick is a no-op for persistence, not a poisoning event.
- The podcast can never speak an attacker's URL, whether hallucinated or injected.
- There is exactly one web-spend path per question, and it's the governed one.
- All three degrade fail-safe: skip-persist, strip, and cache-only respectively —
  never a crash, never an unbounded action.

## Alternatives considered

- **Persist hash vectors but tag them.** Rejected: every reader of the vector
  table would then need to know to exclude them; not writing them is simpler and
  strictly safer.
- **Ground URLs in narration like `discuss` does.** Rejected: a spoken script has
  no legitimate URL at all, so the correct policy is total removal, not grounding.
- **Keep both web paths for resilience.** Rejected: the agent already degrades
  gracefully; a second ungoverned path defeats the budget and the trace the
  agent exists to provide.
