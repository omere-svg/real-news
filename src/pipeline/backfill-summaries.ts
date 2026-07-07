import type { StoryRepo } from '../db/story-repo.js';
import type { RawItemRepo } from '../db/raw-item-repo.js';
import type { PipelineReasoner } from '../llm/llm-client.js';
import type { RawItemRef, Story } from '../domain/types.js';
import { DEFAULT_CONFIRM_CONCURRENCY, mapWithConcurrency } from './concurrency.js';
import { representativeRefOf } from '../domain/cluster.js';
import { hasNonLatinScript, looksNonEnglish } from '../text/language.js';

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
  readonly llm: PipelineReasoner;
}

export interface BackfillOptions {
  /** Re-analyze every Story, not only those missing a summary (e.g. after a prompt change). */
  readonly all?: boolean;
  /** Cap how many Stories to process; 0/undefined means no cap. */
  readonly max?: number;
  /**
   * Max concurrent deep-tier analyze calls (ADR-0039). Each target is one
   * deep-tier round-trip; running them serially makes a 500-Story boot heal take many
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

/** A Story's representative ref — delegates to the single owner of the tie-break
 * (`representativeRefOf`) so the backfill never picks a different lead than the
 * live pipeline (ADR-0051). */
function representativeRef(story: Story): RawItemRef | null {
  return story.memberRefs.length ? representativeRefOf(story.memberRefs) : null;
}

/** True when a Story has no usable factual summary yet (null or blank). */
export function needsSummary(story: Story): boolean {
  return !story.summary || story.summary.trim().length === 0;
}

/**
 * True when a Story has a non-English source title but no English `displayTitle`
 * to render in its place (ADR-0057). A Story analyzed before the display-title
 * era — or one whose displayTitle a pre-fix backfill wiped — would otherwise show
 * its raw foreign headline forever, since the live tick only deep-analyzes the
 * top-N. English-titled Stories are excluded so the heal never re-analyzes the
 * whole store for nothing.
 */
export function needsDisplayTitle(story: Story): boolean {
  return looksNonEnglish(story.title) && (!story.displayTitle || story.displayTitle.trim().length === 0);
}

/**
 * True when a Story's stored summary or why-it-matters is in a non-Latin script
 * (ADR-0059) — i.e. an early deep pass wrote the body in the SOURCE language
 * (e.g. a Chinese lede under an English headline). Re-analyzing rewrites both in
 * English (the analyze prompt now insists on it). Uses the script test, not the
 * accent-sensitive `looksNonEnglish`, so an English summary naming "Beyoncé" or
 * "Łódź" never triggers an endless (expensive) re-analysis.
 */
export function needsEnglishBody(story: Story): boolean {
  return (
    (story.summary !== null && hasNonLatinScript(story.summary)) ||
    (story.whyItMatters !== null && hasNonLatinScript(story.whyItMatters))
  );
}

/**
 * True when a Story still needs deep-tier enrichment: no factual summary, no
 * "why it matters", or a foreign headline lacking an English displayTitle.
 * Stories that got only a deterministic fallback summary (source lead) never
 * entered the top-N, so they have a summary but a null whyItMatters —
 * `needsSummary` alone would skip them forever (ADR-0038).
 */
export function needsAnalysis(story: Story): boolean {
  return (
    needsSummary(story) ||
    !story.whyItMatters ||
    story.whyItMatters.trim().length === 0 ||
    needsDisplayTitle(story) ||
    needsEnglishBody(story)
  );
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
      // Carry the English display headline through too (ADR-0057): the deep tier
      // returns one for every non-English title, and NOT persisting it here would
      // wipe a good displayTitle back to null on every heal — the exact bug that
      // left foreign headlines on the front page.
      const displayTitle = analysis.displayTitle ?? story.displayTitle;
      if (
        summary === story.summary &&
        whyItMatters === story.whyItMatters &&
        displayTitle === story.displayTitle
      ) {
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
        displayTitle,
        // Backfill only rewrites summary/whyItMatters/displayTitle; it does NOT
        // re-score, so it must carry the existing score breakdown through —
        // otherwise upsert nulls the ADR-0032 "why this score" snapshot for every
        // healed Story (ADR-0039).
        scoreBreakdown: story.scoreBreakdown,
        memberRefs: story.memberRefs,
      });

      done += 1;
      opts.onProgress?.(done, targets.length, story);
    },
  );

  return { processed: done, total: targets.length };
}
