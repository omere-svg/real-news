import type { ScoreComponent, Signals } from '../domain/types.js';
import { clamp, clamp01, normalize } from './normalize.js';

/** Tunables injected from config (ADR-0003) so the function stays pure. */
export interface ScoreParams {
  /** Hours after which the recency factor decays one step toward its floor. */
  readonly recencyHalfLifeHours: number;
}

const MIN_SCORE = 0.0;
const MAX_SCORE = 10.0;

/** Reference saturation points for log-normalization of each raw signal. */
const POINTS_REF = 500;
const MENTIONS_REF = 500;
const CORROBORATION_REF = 5;

/**
 * Max contribution of each importance axis to the noisy-OR (ADR-0034). Impact can
 * dominate (a mass-casualty event is top news on its own); authority alone is a
 * partial lift (a routine official item isn't a 10).
 */
const IMPACT_CAP = 1.0;
const CORROBORATION_CAP = 0.9;
const AUTHORITY_CAP = 0.55;
/** Attention (social popularity) is a bounded add-on that never penalizes absence. */
const ATTENTION_BOOST = 0.15;
/** Recency floor: age de-emphasizes but never erases a major story (ADR-0034). */
const RECENCY_FLOOR = 0.5;

/**
 * Recency factor in [RECENCY_FLOOR, 1] (ADR-0034). Unlike a raw exponential, it
 * never drops below the floor — a two-day-old 1,400-death disaster stays major.
 */
function recencyFactorOf(ageHours: number, halfLifeHours: number): number {
  const decay = Math.pow(0.5, Math.max(0, ageHours) / halfLifeHours);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decay;
}

/** The base score plus the normalized strength of each axis (ADR-0032/0034). */
export interface BaseBreakdown {
  /** Impact-first base in [0, 10]. */
  readonly base: number;
  /** Recency factor in [RECENCY_FLOOR, 1] that was applied. */
  readonly recencyFactor: number;
  /** Each axis's normalized strength in [0, 1]. */
  readonly components: readonly ScoreComponent[];
}

/**
 * The impact-first base Significance (ADR-0034). A noisy-OR of the importance
 * axes — real-world `impact`, `corroboration`, source `authority` — so a story
 * strong on ANY of them approaches the top of the scale; `attention` (social
 * popularity) is a bounded add-on that never lowers a story for lacking it. Decayed
 * by a floored recency factor. Pure: same inputs → same output, always in [0, 10].
 */
export function baseScoreBreakdown(
  signals: Signals,
  impact: number,
  params: ScoreParams,
): BaseBreakdown {
  const impact01 = clamp01(impact);
  // A lone source (corroboration = 1) earns no corroboration bonus.
  const corroboration01 = normalize(signals.corroboration - 1, CORROBORATION_REF);
  const authority01 = clamp01(signals.sourceWeight);
  // Social popularity: the louder of upvotes / mentions. Booster only.
  const attention01 = Math.max(
    normalize(signals.points, POINTS_REF),
    normalize(signals.mentions, MENTIONS_REF),
  );

  const recencyFactor = recencyFactorOf(signals.ageHours, params.recencyHalfLifeHours);

  // Noisy-OR: strong on any importance axis ⇒ high. Reaches ~1 only for a major,
  // corroborated, authoritative event — so the full 0–10 range is usable.
  const importance =
    1 -
    (1 - impact01 * IMPACT_CAP) *
      (1 - corroboration01 * CORROBORATION_CAP) *
      (1 - authority01 * AUTHORITY_CAP);
  const quality = clamp01(importance + ATTENTION_BOOST * attention01);
  const base = clamp(MAX_SCORE * quality * recencyFactor, MIN_SCORE, MAX_SCORE);

  const components: ScoreComponent[] = [
    { key: 'impact', value: impact01 },
    { key: 'corroboration', value: corroboration01 },
    { key: 'authority', value: authority01 },
    { key: 'attention', value: attention01 },
  ];
  return { base, recencyFactor, components };
}

/**
 * The deterministic base with no model-estimated impact (impact = 0). Useful where
 * only the verifiable Signals are known; the Score stage adds the impact axis.
 */
export function computeBaseScore(signals: Signals, params: ScoreParams): number {
  return baseScoreBreakdown(signals, 0, params).base;
}
