import type { Region, SignalObservation, SourceId, Topic } from '../domain/types.js';

/**
 * The Signal coupling (ADR-0025). Turns a tick's numeric `SignalObservation`s
 * into a partition-keyed **salience** in [0, 1], then a bounded significance
 * nudge. Pure and inspectable — no LLM, no hidden state. `computeBaseScore`
 * stays untouched; this is an explicit post-term applied in the Score stage.
 */

/**
 * Per-source log-normalization reference: the observed value at which salience
 * approaches 1.0. Different signals live on wildly different scales (monthly
 * pageviews in the hundreds of thousands; macro volatility in single-digit
 * percent), so each source saturates against its own reference.
 */
const DEFAULT_REFS: Partial<Record<SourceId, number>> = {
  'wikipedia-pageviews': 500_000, // ~peak monthly views for a hot article
  worldbank: 10, // ~10% year-over-year swing is a strong macro signal
};

const FALLBACK_REF = 500_000;

export interface SignalContextParams {
  /** Override the saturation reference per source. */
  readonly refBySource?: Partial<Record<SourceId, number>>;
}

/** Opaque salience map, keyed by partition. Build with `assembleSignalContext`. */
export interface SignalContext {
  /** Salience ∈ [0, 1] per `partitionKey(region, topic)`. */
  readonly salience: ReadonlyMap<string, number>;
}

/** The no-signal context — yields a zero adjustment, leaving base scoring intact. */
export const EMPTY_SIGNAL_CONTEXT: SignalContext = { salience: new Map() };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Stable partition key; `topic === null` is the region-wide bucket. */
function partitionKey(region: Region, topic: Topic | null): string {
  return `${region}::${topic ?? '*'}`;
}

/** Log-normalize a non-negative value against a reference into ~[0, 1]. */
function normalize(value: number, ref: number): number {
  return clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(ref));
}

/**
 * Reduce a tick's observations to peak salience per partition. Each observation
 * is normalized against its source's reference, and the strongest reading in a
 * partition wins (one loud signal shouldn't be diluted by quiet ones).
 */
export function assembleSignalContext(
  observations: readonly SignalObservation[],
  params: SignalContextParams = {},
): SignalContext {
  const refs = { ...DEFAULT_REFS, ...params.refBySource };
  const salience = new Map<string, number>();

  for (const o of observations) {
    const ref = refs[o.source] ?? FALLBACK_REF;
    const s = normalize(o.value, ref);
    const key = partitionKey(o.region, o.topic);
    salience.set(key, Math.max(salience.get(key) ?? 0, s));
  }

  return { salience };
}

/**
 * The bounded significance nudge for a cluster's partition. Prefers the exact
 * `(region, topic)` salience, falls back to the region-wide `(region, null)`
 * bucket, and scales the result to `[0, maxAdjustment]`. Positive-only: a quiet
 * signal is neutral, never a penalty (ADR-0025).
 */
export function signalAdjustment(
  region: Region,
  topic: Topic,
  ctx: SignalContext,
  maxAdjustment: number,
): number {
  const salience =
    ctx.salience.get(partitionKey(region, topic)) ??
    ctx.salience.get(partitionKey(region, null)) ??
    0;
  return clamp01(salience) * Math.max(0, maxAdjustment);
}
