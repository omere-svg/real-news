import type {
  ScoreComponent,
  ScoreComponentKey,
  Signals,
} from '../domain/types.js';

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

/** The deterministic base score plus its component decomposition (ADR-0032). */
export interface BaseBreakdown {
  /** Deterministic base in [0, 10]. */
  readonly base: number;
  /** Recency multiplier in [0, 1] applied to every component. */
  readonly recencyFactor: number;
  /** Per-component contributions to `base`, in points; they sum to `base`. */
  readonly contributions: readonly ScoreComponent[];
}

/**
 * The deterministic base Significance (ADR-0008) decomposed into its parts
 * (ADR-0032). Each component is normalized to [0, 1], weighted, scaled to points
 * and decayed by recency, so the contributions sum to the same `base` that
 * `computeBaseScore` returns. Pure: same inputs → same output.
 */
export function baseScoreBreakdown(
  signals: Signals,
  params: ScoreParams,
): BaseBreakdown {
  const components01: Record<ScoreComponentKey, number> = {
    popularity: normalize(signals.points, POINTS_REF),
    engagement: normalize(signals.mentions, MENTIONS_REF),
    // A lone source (corroboration = 1) earns no corroboration bonus.
    corroboration: normalize(signals.corroboration - 1, CORROBORATION_REF),
    // Extremity, not direction: a strongly-toned story (either sign) is weightier.
    toneExtremity: clamp01(Math.abs(signals.tone) / 10),
    // Editorial trust in the strongest contributing source.
    sourceWeight: clamp01(signals.sourceWeight),
  };

  // Exponential recency decay: halves every `recencyHalfLifeHours`.
  const recencyFactor = Math.pow(
    0.5,
    Math.max(0, signals.ageHours) / params.recencyHalfLifeHours,
  );

  const keys = Object.keys(WEIGHTS) as ScoreComponentKey[];
  const contributions: ScoreComponent[] = keys.map((key) => ({
    key,
    points: MAX_SCORE * WEIGHTS[key] * components01[key] * recencyFactor,
  }));

  const base = clamp(
    contributions.reduce((sum, c) => sum + c.points, 0),
    MIN_SCORE,
    MAX_SCORE,
  );
  return { base, recencyFactor, contributions };
}

/**
 * The deterministic base Significance (ADR-0008) from verifiable Signals.
 * Pure: same inputs → same output. Result is always within [0.0, 10.0].
 */
export function computeBaseScore(signals: Signals, params: ScoreParams): number {
  return baseScoreBreakdown(signals, params).base;
}
