import { describe, expect, it } from 'vitest';
import { applyFeedback, NEUTRAL_WEIGHT } from '../../src/preferences/feedback.js';
import type { PreferenceProfile } from '../../src/preferences/feedback.js';
import type { FeedbackIntent } from '../../src/llm/llm-client.js';

const EMPTY: PreferenceProfile = { topicWeights: {} };
const OPTS = { minutesFallback: 5, maxMinutes: 60 };

function intent(over: Partial<FeedbackIntent> = {}): FeedbackIntent {
  return { topics: [], length: null, summary: '', ...over };
}

describe('applyFeedback', () => {
  it('"more" raises a topic weight above neutral; "less" lowers it', () => {
    const more = applyFeedback(EMPTY, intent({ topics: [{ topic: 'AI', direction: 'more' }] }), OPTS);
    expect(more.topicWeights.AI).toBeGreaterThan(NEUTRAL_WEIGHT);

    const less = applyFeedback(EMPTY, intent({ topics: [{ topic: 'Sports', direction: 'less' }] }), OPTS);
    expect(less.topicWeights.Sports).toBeLessThan(NEUTRAL_WEIGHT);
    expect(less.topicWeights.Sports).toBeGreaterThan(0); // "less" de-emphasizes, never fully mutes
  });

  it('"mute" sets weight to 0; "reset" returns to neutral (key removed)', () => {
    const muted = applyFeedback(EMPTY, intent({ topics: [{ topic: 'Sports', direction: 'mute' }] }), OPTS);
    expect(muted.topicWeights.Sports).toBe(0);

    const reset = applyFeedback(muted, intent({ topics: [{ topic: 'Sports', direction: 'reset' }] }), OPTS);
    expect(reset.topicWeights.Sports).toBeUndefined(); // neutral ≡ absent
  });

  it('"less" on an already-muted topic keeps it muted, not resurrected (ADR-0049)', () => {
    const muted = applyFeedback(EMPTY, intent({ topics: [{ topic: 'Sports', direction: 'mute' }] }), OPTS);
    const stillMuted = applyFeedback(muted, intent({ topics: [{ topic: 'Sports', direction: 'less' }] }), OPTS);
    expect(stillMuted.topicWeights.Sports).toBe(0); // reinforcing a mute must not un-mute
  });

  it('accumulates across calls and clamps to the allowed range', () => {
    let p = EMPTY;
    for (let i = 0; i < 10; i += 1) {
      p = applyFeedback(p, intent({ topics: [{ topic: 'AI', direction: 'more' }] }), OPTS);
    }
    expect(p.topicWeights.AI).toBeLessThanOrEqual(3); // clamped, doesn't grow unbounded
    expect(p.topicWeights.AI).toBeGreaterThan(NEUTRAL_WEIGHT);
  });

  it('applies the Israel topic the same way as any other', () => {
    const p = applyFeedback(EMPTY, intent({ topics: [{ topic: 'Israel', direction: 'more' }] }), OPTS);
    expect(p.topicWeights.Israel).toBeGreaterThan(NEUTRAL_WEIGHT);
  });

  it('"shorter"/"longer" nudge minutes from the fallback and clamp to maxMinutes', () => {
    const shorter = applyFeedback(EMPTY, intent({ length: 'shorter' }), OPTS);
    expect(shorter.minutes).toBeLessThan(OPTS.minutesFallback);
    expect(shorter.minutes).toBeGreaterThanOrEqual(1);

    const longer = applyFeedback(EMPTY, intent({ length: 'longer' }), OPTS);
    expect(longer.minutes).toBeGreaterThan(OPTS.minutesFallback);

    const capped = applyFeedback({ ...EMPTY, minutes: 50 }, intent({ length: 'longer' }), OPTS);
    expect(capped.minutes).toBeLessThanOrEqual(OPTS.maxMinutes);
  });

  it('"reset" length clears the custom minutes (back to default)', () => {
    const reset = applyFeedback({ ...EMPTY, minutes: 12 }, intent({ length: 'reset' }), OPTS);
    expect(reset.minutes).toBeUndefined();
  });

  it('an empty intent leaves the profile unchanged and never mutates the input', () => {
    const before: PreferenceProfile = { topicWeights: { AI: 1.5 }, minutes: 8 };
    const frozen = JSON.stringify(before);
    const after = applyFeedback(before, intent(), OPTS);

    expect(after).toEqual(before);
    expect(JSON.stringify(before)).toBe(frozen); // input untouched
    expect(after.topicWeights).not.toBe(before.topicWeights); // returns a fresh object
  });
});
