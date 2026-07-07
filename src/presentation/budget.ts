import type { Story } from '../domain/types.js';

/**
 * Attention & time budgeting (ADR-0013, Principle 5). A pure kernel — no DB, no
 * LLM, no clock — that maps a time constraint onto the pre-computed Significance
 * scores: how many Stories fit, and how much depth each gets. Same role and
 * testability as `computeBaseScore` (ADR-0008).
 */

/** How much of a Story a renderer should surface. Ordered shallow → deep. */
export type Depth = 'headline' | 'brief' | 'full';

const DEPTH_ORDER: readonly Depth[] = ['headline', 'brief', 'full'] as const;

/** Tunables injected by the caller (per format) so the function stays pure. */
export interface BudgetParams {
  /** Delivery rate: words consumed per minute (reading is faster than speaking). */
  readonly wordsPerMinute: number;
  /** Word cost of rendering a Story at each depth. Must be ascending. */
  readonly wordCost: Record<Depth, number>;
  /**
   * Readability floor (ADR-0024): no Story is admitted below this depth, so every
   * Story shown carries real context. `full` ⇒ each gets its full "why it matters".
   */
  readonly minDepth: Depth;
  /**
   * Always include at least this many Stories (if available), even if it exceeds
   * the word budget — readability beats minute-precision at tiny budgets (ADR-0024).
   */
  readonly minStories: number;
  /**
   * Never include more than this many Stories, regardless of the budget — bounds
   * a large-minute brief so it stays sane and fits delivery limits (ADR-0024).
   */
  readonly maxStories: number;
  /**
   * The priority key Stories are admitted/deepened by. Defaults to raw
   * Significance; the Presentation layer injects a preference-weighted key so a
   * favored topic ranks higher (ADR-0026), without altering the displayed score.
   */
  readonly rank?: (story: Story) => number;
  /**
   * Same-event diversity guard (ADR-0053): when set, a candidate similar to an
   * already-admitted Story is skipped — one developing event never fills two
   * slots of one brief, even when upstream dedup left it as separate Stories.
   */
  readonly suppressSimilar?: (a: Story, b: Story) => boolean;
}

/** One Story admitted to the budget, with the depth it earned. */
export interface BudgetedStory {
  readonly story: Story;
  readonly depth: Depth;
}

function nextDepth(depth: Depth): Depth | null {
  const i = DEPTH_ORDER.indexOf(depth);
  return DEPTH_ORDER[i + 1] ?? null;
}

/**
 * Allocate a time budget across Stories, readability-first (ADR-0013/0024):
 * 1. Admit — take Stories in Significance order at the `minDepth` floor while they
 *    fit, but always admit at least `minStories` (even over budget) so a tiny
 *    request still yields a few *fully-rendered* Stories rather than many headlines.
 * 2. Deepen — spend any leftover top-heavy, upgrading the most significant Stories
 *    toward `full` (a no-op when the floor is already `full`).
 * Returns the selection ordered by Significance descending.
 */
export function budgetStories(
  stories: readonly Story[],
  minutes: number,
  params: BudgetParams,
): BudgetedStory[] {
  const wordBudget = Math.max(0, minutes) * params.wordsPerMinute;
  const { wordCost, minDepth, minStories, maxStories } = params;
  const floorCost = wordCost[minDepth];
  const rankOf = params.rank ?? ((s: Story) => s.significance);

  const ranked = [...stories].sort((a, b) => rankOf(b) - rankOf(a));

  // Admit at the readability floor; force at least `minStories` regardless of
  // budget, but never exceed `maxStories` (the cap wins over the floor).
  const selected: { story: Story; depth: Depth }[] = [];
  let spent = 0;
  for (const story of ranked) {
    if (selected.length >= maxStories) break;
    const mustInclude = selected.length < minStories;
    if (!mustInclude && spent + floorCost > wordBudget) break;
    // Same-event guard (ADR-0053): a near-duplicate of an admitted Story is
    // skipped without spending budget — the slot goes to the next distinct one.
    if (params.suppressSimilar && selected.some((s) => params.suppressSimilar!(s.story, story))) {
      continue;
    }
    selected.push({ story, depth: minDepth });
    spent += floorCost;
  }

  // Deepen pass: spend leftover budget top-heavy, from the floor toward `full`.
  for (const entry of selected) {
    for (let next = nextDepth(entry.depth); next; next = nextDepth(entry.depth)) {
      const delta = wordCost[next] - wordCost[entry.depth];
      if (spent + delta > wordBudget) break;
      entry.depth = next;
      spent += delta;
    }
  }

  return selected;
}
