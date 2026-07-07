import { describe, expect, it } from 'vitest';
import { budgetStories, type BudgetParams } from '../../src/presentation/budget.js';
import type { Story } from '../../src/domain/types.js';

/** Simple integer tunables so the budget arithmetic is obvious in assertions. */
const PARAMS: BudgetParams = {
  wordsPerMinute: 10,
  wordCost: { headline: 10, brief: 20, full: 40 },
  minDepth: 'headline', // no floor → exercises the general pyramid behavior
  minStories: 0,
  maxStories: 100, // effectively uncapped for the general tests
};

function story(id: string, significance: number): Story {
  return {
    id,
    title: `Story ${id}`,
    url: null,
    topic: 'AI',
    significance,
    summary: null,
    whyItMatters: null,
    scoreBreakdown: null,
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

  // --- Readability floor (ADR-0024) ---

  const FLOOR: BudgetParams = {
    wordsPerMinute: 10,
    wordCost: { headline: 10, brief: 20, full: 40 },
    minDepth: 'full',
    minStories: 3,
    maxStories: 100,
  };

  it('floors every admitted story at minDepth instead of headlines', () => {
    const stories = [story('a', 9), story('b', 8), story('c', 7), story('d', 6)];
    // 20 min * 10 = 200 words; full=40 → 5 fit, but only 4 exist.
    const sel = budgetStories(stories, 20, FLOOR);
    expect(depths(sel)).toEqual(['full', 'full', 'full', 'full']);
  });

  it('guarantees minStories even when the budget is tiny (readability over precision)', () => {
    const stories = [story('a', 9), story('b', 8), story('c', 7), story('d', 6)];
    // 1 min * 10 = 10 words — affords < 1 full story, but minStories=3 forces 3.
    const sel = budgetStories(stories, 1, FLOOR);
    expect(ids(sel)).toEqual(['a', 'b', 'c']);
    expect(depths(sel)).toEqual(['full', 'full', 'full']);
  });

  it('scales the count up with the budget, above the floor', () => {
    const stories = Array.from({ length: 10 }, (_, i) => story(`s${i}`, 20 - i));
    // 24 min * 10 = 240 words; full=40 → 6 full stories.
    expect(budgetStories(stories, 24, FLOOR)).toHaveLength(6);
  });

  it('never forces more than the stories available', () => {
    const sel = budgetStories([story('only', 9)], 1, FLOOR);
    expect(ids(sel)).toEqual(['only']); // minStories=3 but only 1 exists
  });

  it('caps the selection at maxStories even with a huge budget', () => {
    const stories = Array.from({ length: 30 }, (_, i) => story(`s${i}`, 30 - i));
    const capped = { ...FLOOR, maxStories: 5 };
    // 1000 min would otherwise admit dozens; the cap holds it to 5 (most significant).
    const sel = budgetStories(stories, 1000, capped);
    expect(sel).toHaveLength(5);
    expect(ids(sel)).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('the cap wins over minStories when they conflict', () => {
    const stories = Array.from({ length: 10 }, (_, i) => story(`s${i}`, 10 - i));
    const sel = budgetStories(stories, 1, { ...FLOOR, minStories: 8, maxStories: 3 });
    expect(sel).toHaveLength(3);
  });
});

describe('budgetStories same-event suppression (ADR-0053)', () => {
  // Pretend stories whose ids share a first letter cover the same event.
  const sameEvent = (a: Story, b: Story) => a.id[0] === b.id[0];

  it('skips a near-duplicate of an admitted story and admits the next distinct one', () => {
    const sel = budgetStories(
      [story('a1', 9), story('a2', 8), story('b1', 7)],
      10, // 100-word budget: room for all three headlines
      { ...PARAMS, suppressSimilar: sameEvent },
    );
    expect(ids(sel)).toEqual(['a1', 'b1']); // a2 suppressed as a dup of a1
  });

  it('suppression frees budget for the next distinct story', () => {
    // Budget fits exactly two headlines; the dup must not eat the second slot.
    const sel = budgetStories(
      [story('a1', 9), story('a2', 8), story('b1', 7), story('c1', 6)],
      2,
      { ...PARAMS, suppressSimilar: sameEvent },
    );
    expect(ids(sel)).toEqual(['a1', 'b1']);
  });

  it('without the hook, behavior is unchanged', () => {
    const sel = budgetStories([story('a1', 9), story('a2', 8)], 10, PARAMS);
    expect(ids(sel)).toEqual(['a1', 'a2']);
  });
});
