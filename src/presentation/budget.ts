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
 * Allocate a time budget across Stories as an inverted pyramid (ADR-0013):
 * 1. Breadth — admit Stories in Significance order at `headline` cost while they fit.
 * 2. Depth — spend the leftover top-heavy: deepen the most significant Story as far
 *    as it will go before moving to the next.
 * Returns the selection ordered by Significance descending. Never exceeds the budget.
 */
export function budgetStories(
  stories: readonly Story[],
  minutes: number,
  params: BudgetParams,
): BudgetedStory[] {
  const wordBudget = Math.max(0, minutes) * params.wordsPerMinute;
  const { wordCost } = params;

  const ranked = [...stories].sort((a, b) => b.significance - a.significance);

  // Breadth pass: how many Stories fit at the cheapest depth.
  const selected: { story: Story; depth: Depth }[] = [];
  let spent = 0;
  for (const story of ranked) {
    if (spent + wordCost.headline > wordBudget) break;
    selected.push({ story, depth: 'headline' });
    spent += wordCost.headline;
  }

  // Depth pass: spend leftover budget top-heavy.
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
