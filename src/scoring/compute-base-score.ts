import type { Signals } from '../domain/types.js';

/** Tunables injected from config (ADR-0003) so the function stays pure. */
export interface ScoreParams {
  /** Hours after which recency decay roughly halves the contribution. */
  readonly recencyHalfLifeHours: number;
}

const MIN_SCORE = 0.0;
const MAX_SCORE = 10.0;

/** Reference saturation points for log-normalization of each raw signal. */
const POINTS_REF = 500;
const MENTIONS_REF = 500;
const CORROBORATION_REF = 5;

/**
 * Relative contribution of each quality component to the base score.
 * MUST sum to 1.0 so quality lands in [0, 1] before scaling to [0, 10].
 */
const WEIGHTS = {
  popularity: 0.3,
  engagement: 0.15,
  corroboration: 0.3,
  toneExtremity: 0.1,
  sourceWeight: 0.15,
} as const;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

const clamp01 = (value: number): number => clamp(value, 0, 1);

/**
 * Log-normalize a raw count to ~[0, 1]: diminishing returns as it approaches
 * `ref`, so 10k vs 11k barely moves while 0 vs 100 moves a lot.
 */
function normalize(value: number, ref: number): number {
  return clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(ref));
}

/**
 * The deterministic base Significance (ADR-0008) from verifiable Signals.
 * Pure: same inputs → same output. Result is always within [0.0, 10.0].
 */
export function computeBaseScore(signals: Signals, params: ScoreParams): number {
  const popularity = normalize(signals.points, POINTS_REF);
  const engagement = normalize(signals.mentions, MENTIONS_REF);
  // A lone source (corroboration = 1) earns no corroboration bonus.
  const corroboration = normalize(signals.corroboration - 1, CORROBORATION_REF);
  // Extremity, not direction: a strongly-toned story (either sign) is weightier.
  const toneExtremity = clamp01(Math.abs(signals.tone) / 10);
  // Editorial trust in the strongest contributing source.
  const weight = clamp01(signals.sourceWeight);

  const quality =
    WEIGHTS.popularity * popularity +
    WEIGHTS.engagement * engagement +
    WEIGHTS.corroboration * corroboration +
    WEIGHTS.toneExtremity * toneExtremity +
    WEIGHTS.sourceWeight * weight;

  // Exponential recency decay: halves every `recencyHalfLifeHours`.
  const recency = Math.pow(
    0.5,
    Math.max(0, signals.ageHours) / params.recencyHalfLifeHours,
  );

  return clamp(MAX_SCORE * quality * recency, MIN_SCORE, MAX_SCORE);
}
