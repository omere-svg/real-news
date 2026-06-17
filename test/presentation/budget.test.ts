import { describe, expect, it } from 'vitest';
import { budgetStories, type BudgetParams } from '../../src/presentation/budget.js';
import type { Story } from '../../src/domain/types.js';

/** Simple integer tunables so the budget arithmetic is obvious in assertions. */
const PARAMS: BudgetParams = {
  wordsPerMinute: 10,
  wordCost: { headline: 10, brief: 20, full: 40 },
};

function story(id: string, significance: number): Story {
  return {
    id,
    title: `Story ${id}`,
    url: null,
    region: 'World',
    topic: 'AI',
    significance,
    whyItMatters: null,
    memberRefs: [],
    firstSeenAt: 0,
    updatedAt: 0,
  };
}

const ids = (sel: { story: Story }[]) => sel.map((s) => s.story.id);
const depths = (sel: { depth: string }[]) => sel.map((s) => s.depth);

describe('budgetStories', () => {
  it('returns nothing when there is no budget', () => {
    expect(budgetStories([story('a', 9)], 0, PARAMS)).toEqual([]);
    expect(budgetStories([story('a', 9)], -5, PARAMS)).toEqual([]);
  });

  it('returns nothing when the budget cannot afford a single headline', () => {
    // 0.5 min * 10 wpm = 5 words < headline cost 10.
    expect(budgetStories([story('a', 9)], 0.5, PARAMS)).toEqual([]);
  });

  it('orders selection by significance descending', () => {
    const stories = [story('low', 2), story('high', 9), story('mid', 5)];
    // 3 min * 10 = 30 words; 3 headlines (10 each) fit exactly.
    const sel = budgetStories(stories, 3, PARAMS);
    expect(ids(sel)).toEqual(['high', 'mid', 'low']);
  });

  it('admits as many headlines as the budget holds (breadth pass)', () => {
    const stories = [story('a', 9), story('b', 8), story('c', 7), story('d', 6)];
    // 2 min * 10 = 20 words -> exactly 2 headlines, no leftover to upgrade.
    const sel = budgetStories(stories, 2, PARAMS);
    expect(ids(sel)).toEqual(['a', 'b']);
    expect(depths(sel)).toEqual(['headline', 'headline']);
  });

  it('spends leftover budget top-heavy: the most significant story deepens first', () => {
    const stories = [story('a', 9), story('b', 8)];
    // 5 min * 10 = 50 words. Breadth: 2 headlines = 20. Leftover 30.
    // Top-heavy: upgrade 'a' headline->brief (+10 -> 30) ->full (+20 -> 50). Budget spent.
    // 'b' stays headline.
    const sel = budgetStories(stories, 5, PARAMS);
    expect(ids(sel)).toEqual(['a', 'b']);
    expect(depths(sel)).toEqual(['full', 'headline']);
  });

  it('deepens the whole selection when the budget is generous', () => {
    const stories = [story('a', 9), story('b', 8)];
    // 8 min * 10 = 80 words = both at full (40 + 40).
    const sel = budgetStories(stories, 8, PARAMS);
    expect(depths(sel)).toEqual(['full', 'full']);
  });

  it('never exceeds the word budget', () => {
    const stories = Array.from({ length: 20 }, (_, i) => story(`s${i}`, 20 - i));
    const minutes = 7; // 70 words
    const sel = budgetStories(stories, minutes, PARAMS);
    const spent = sel.reduce((sum, s) => sum + PARAMS.wordCost[s.depth], 0);
    expect(spent).toBeLessThanOrEqual(minutes * PARAMS.wordsPerMinute);
  });

  it('does not mutate the input array order', () => {
    const stories = [story('low', 2), story('high', 9)];
    const snapshot = ids(stories.map((s) => ({ story: s })));
    budgetStories(stories, 3, PARAMS);
    expect(ids(stories.map((s) => ({ story: s })))).toEqual(snapshot);
  });
});
