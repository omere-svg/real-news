import type { StoryRepo } from '../db/story-repo.js';
import type { RawItemRepo } from '../db/raw-item-repo.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { RawItemRef, Story } from '../domain/types.js';
import { DEFAULT_CONFIRM_CONCURRENCY, mapWithConcurrency } from './concurrency.js';

/**
 * Backfill a Story's factual `summary` + concise `whyItMatters` via the deep tier
 * for Stories already in the cache. The Tick only analyzes the top-N clusters it
 * re-fetches each cycle, so Stories from earlier ticks (or that only ever got a
 * deterministic fallback summary) can sit with a null summary and/or a null
 * `whyItMatters` forever; `needsAnalysis` targets both. Idempotent: it upserts in
 * place, preserving id, url, membership and first-seen time. Processes the most
 * significant Stories first so the displayed brief heals first.
 */
export interface BackfillDeps {
  readonly storyRepo: StoryRepo;
  readonly rawItemRepo: RawItemRepo;
  readonly llm: LLMClient;
}

export interface BackfillOptions {
  /** Re-analyze every Story, not only those missing a summary (e.g. after a prompt change). */
  readonly all?: boolean;
  /** Cap how many Stories to process; 0/undefined means no cap. */
  readonly max?: number;
  /**
   * Max concurrent deep-tier analyze calls (ADR-0039). Each target is one gpt-4o
   * round-trip; running them serially makes a 500-Story boot heal take many
   * minutes. Bounded concurrency keeps the heal fast without a request flood.
   */
  readonly concurrency?: number;
  /** Per-Story progress hook (1-based `done` of `total`). */
  readonly onProgress?: (done: number, total: number, story: Story) => void;
}

export interface BackfillResult {
  readonly processed: number;
  readonly total: number;
}

/** A Story's representative ref: the lowest (source, externalId) — matches the pipeline. */
function representativeRef(story: Story): RawItemRef | null {
  const [ref] = [...story.memberRefs].sort((a, b) =>
    a.source === b.source
      ? a.externalId.localeCompare(b.externalId)
      : a.source.localeCompare(b.source),
  );
  return ref ?? null;
}

/** True when a Story has no usable factual summary yet (null or blank). */
export function needsSummary(story: Story): boolean {
  return !story.summary || story.summary.trim().length === 0;
}

/**
 * True when a Story still needs deep-tier enrichment: either no factual summary,
 * or no "why it matters". Stories that got only a deterministic fallback summary
 * (source lead) never entered the top-N, so they have a summary but a null
 * whyItMatters — `needsSummary` alone would skip them forever (ADR-0038).
 */
export function needsAnalysis(story: Story): boolean {
  return needsSummary(story) || !story.whyItMatters || story.whyItMatters.trim().length === 0;
}

export async function backfillSummaries(
  deps: BackfillDeps,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const all = await deps.storyRepo.all();
  let targets = opts.all ? all : all.filter(needsAnalysis);
  // Most significant first: the stories most likely to be displayed heal first.
  // With bounded concurrency the top `concurrency` targets are the ones dispatched
  // first, so the significance ordering still governs which heal soonest (ADR-0039).
  targets = [...targets].sort((a, b) => b.significance - a.significance);
  if (opts.max && opts.max > 0) targets = targets.slice(0, opts.max);

  let done = 0;
  await mapWithConcurrency(
    targets,
    opts.concurrency ?? DEFAULT_CONFIRM_CONCURRENCY,
    async (story) => {
      const ref = representativeRef(story);
      const lead = ref ? await deps.rawItemRepo.get(ref) : null;

      const analysis = await deps.llm.analyze({
        title: lead?.title ?? story.title,
        text: lead?.text ?? null,
        topic: story.topic,
        significance: story.significance,
      });

      // A degraded/blank analyze returns nulls (ADR-0047): keep the existing text
      // rather than wiping it, and skip the write entirely when nothing improved
      // (so a persistent LLM outage can't churn the store with no-op upserts).
      const summary = analysis.summary ?? story.summary;
      const whyItMatters = analysis.whyItMatters ?? story.whyItMatters;
      if (summary === story.summary && whyItMatters === story.whyItMatters) {
        done += 1;
        opts.onProgress?.(done, targets.length, story);
        return;
      }

      await deps.storyRepo.upsert({
        id: story.id,
        title: story.title,
        url: story.url,
        topic: story.topic,
        significance: story.significance,
        summary,
        whyItMatters,
        // Backfill only rewrites summary/whyItMatters; it does NOT re-score, so it
        // must carry the existing score breakdown through — otherwise upsert nulls
        // the ADR-0032 "why this score" snapshot for every healed Story (ADR-0039).
        scoreBreakdown: story.scoreBreakdown,
        memberRefs: story.memberRefs,
      });

      done += 1;
      opts.onProgress?.(done, targets.length, story);
    },
  );

  return { processed: done, total: targets.length };
}
