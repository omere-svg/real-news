import type { Topic } from '../domain/types.js';
import type { FeedbackIntent, WeightDirection } from '../llm/llm-client.js';

/**
 * The deterministic half of feedback (ADR-0026). The Reasoner turns free text
 * into a `FeedbackIntent` (directions only); this pure function turns directions
 * into a new `PreferenceProfile` — all the numeric weight math, clamped and
 * inspectable, with no model and no I/O. The model never touches a number.
 */

/** A chat's soft preference weights + feedback-adjusted default minutes. */
export interface PreferenceProfile {
  /** Per-topic ranking weight; absent ≡ neutral. */
  readonly topicWeights: Partial<Record<Topic, number>>;
  /** Feedback-set default budget; absent ≡ use the config/chat default. */
  readonly minutes?: number;
}

export interface ApplyFeedbackOpts {
  /** Effective minutes to nudge from when the profile has none set. */
  readonly minutesFallback: number;
  /** Hard ceiling on minutes (ADR-0023). */
  readonly maxMinutes: number;
}

/** Neutral weight — a partition neither emphasized nor de-emphasized. */
export const NEUTRAL_WEIGHT = 1;
const STEP = 0.5;
const MIN_ACTIVE = 0.25; // "less" floors here; only "mute" reaches 0
const MAX_WEIGHT = 3;
const SHORTER = 0.6;
const LONGER = 1.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The new weight for one direction. Returns `undefined` to mean "remove the key"
 * (reset to neutral), `0` to mute, else a clamped active weight.
 */
function nextWeight(current: number, direction: WeightDirection): number | undefined {
  switch (direction) {
    case 'more':
      return clamp(current + STEP, MIN_ACTIVE, MAX_WEIGHT);
    case 'less':
      return clamp(current - STEP, MIN_ACTIVE, MAX_WEIGHT);
    case 'mute':
      return 0;
    case 'reset':
      return undefined;
  }
}

/** Apply one direction onto a weights map, returning a fresh map (immutable). */
function applyDirections<K extends string>(
  weights: Partial<Record<K, number>>,
  entries: ReadonlyArray<{ key: K; direction: WeightDirection }>,
): Partial<Record<K, number>> {
  const next = { ...weights };
  for (const { key, direction } of entries) {
    const w = nextWeight(next[key] ?? NEUTRAL_WEIGHT, direction);
    if (w === undefined) delete next[key];
    else next[key] = w;
  }
  return next;
}

/** Fold a `FeedbackIntent` into a new `PreferenceProfile`. Pure. */
export function applyFeedback(
  profile: PreferenceProfile,
  intent: FeedbackIntent,
  opts: ApplyFeedbackOpts,
): PreferenceProfile {
  const topicWeights = applyDirections(
    profile.topicWeights,
    intent.topics.map((t) => ({ key: t.topic, direction: t.direction })),
  );

  let minutes = profile.minutes;
  if (intent.length === 'reset') {
    minutes = undefined;
  } else if (intent.length === 'shorter' || intent.length === 'longer') {
    const factor = intent.length === 'shorter' ? SHORTER : LONGER;
    const base = profile.minutes ?? opts.minutesFallback;
    minutes = clamp(Math.round(base * factor), 1, opts.maxMinutes);
  }

  return {
    topicWeights,
    ...(minutes !== undefined ? { minutes } : {}),
  };
}
