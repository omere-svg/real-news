# ADR-0027: Per-bullet source links in the brief (provenance)

- **Status:** Accepted — implemented 2026-06-25.
- **Date:** 2026-06-25
- **Deciders:** Project Horizon team
- **Extends:** ADR-0014 (deterministic render), ADR-0005 (two-tier schema).

## Context

Roadmap Phase 6, item 12. The text brief shows each Story's title, Significance,
Region/Topic and Why-It-Matters, but **not where it came from** — undercutting the
"show your sources" editorial promise. The data already exists: a `Story` carries a
canonical `url`, and traces back to its Raw Items via `membership` (each Raw Item
keeps its origin `url`). The web viewer already links Story titles (`ui.ts`); only
the generated **brief/outline** text (consumed by both the web `<pre>` and Telegram)
lacked links.

## Decision

Append a **source link line** to every rendered Story in `HorizonQuery`'s
deterministic renderer (`renderStory`): after the headline (and any Why-It-Matters
at the budgeted depth), emit `↗ <url>` when the Story has a canonical `url`.

- The link is the Story's **canonical `url`** — the primary member chosen by the
  pipeline at upsert — kept as a single line so it survives Telegram's
  message-splitting and reads cleanly in the web viewer's `<pre>`.
- The renderer stays **pure and I/O-free** (Principle 4): it uses only fields
  already on the `Story`, so no Raw Item lookup and no change to the attention
  budget's word-cost model (ADR-0013).
- Stories without a `url` (e.g. some numeric-led items) simply omit the line.

## Consequences

- **Easier:** every brief bullet is now traceable to its source in both
  Presentation surfaces, from one change in the shared renderer.
- **Bounded:** one helper in `horizon-query.ts`; budgeting, schemas and the bot
  are untouched.
- **Accepted trade-offs:**
  - **One primary link, not all members.** Corroborated Stories list only the
    canonical link, not every member URL. Listing all members would need a Raw
    Item lookup, breaking the renderer's purity; the web viewer already shows the
    distinct source *names*. Per-member URLs can come later behind a hydrated view.

## Alternatives considered

- **List every member URL inline.** Rejected for now: requires I/O in the
  renderer (or a heavier hydrated Story), and clutters the bullet.
- **Footnote-style references at the end of the brief.** Rejected: harder to scan
  and brittle under Telegram chunking; an inline link per bullet is clearer.

## Addendum — structured story card + guaranteed link (2026-06-25)

Two refinements landed after the initial decision, keeping the renderer pure:

- **Structured card.** Each Story now renders as a consistent block — `📰 headline`
  → factual *what happened* (`summary`) → `💡 why it matters` (`whyItMatters`) →
  `🏷 region · topic · significance` → `🔗 link`. The deep tier (`analyze`) returns
  both `summary` and `whyItMatters` in **one** JSON call, persisted on the Story
  (`stories.summary`, migration `0007`). Depth budgeting (ADR-0013) controls
  verbosity: `headline` shows only headline/tag/link, `brief` adds the two-sentence
  summary, `full` adds the why-it-matters line.
- **Guaranteed link.** The link emoji moved from `↗` to `🔗`, and `toStoryUpsert`
  now falls back from the representative's `url` to the **first member that carries
  one**, so a corroborated Story is never link-less when any member has a URL. This
  supersedes the "one primary link" trade-off above for the common case while
  staying I/O-free (member URLs are already in the cluster at upsert time).
