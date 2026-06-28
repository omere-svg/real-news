import type { SignalObservation, SourceId, Topic } from '../domain/types.js';

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
 * percent), so each source saturates against its own scale. The scale is
 * **owned by the source** — every `SignalSource` declares its `saturationReference`
 * and the composition root derives this map from the live sources, so adding a
 * source is a single-file change and a forgotten scale can never silently
 * misnormalize a feed (ADR-0031). The scoring module holds no per-source numbers.
 */
export type SaturationRefs = Partial<Record<SourceId, number>>;

/** Opaque salience map, keyed by topic. Build with `assembleSignalContext`. */
export interface SignalContext {
  /** Salience ∈ [0, 1] per `partitionKey(topic)`. */
  readonly salience: ReadonlyMap<string, number>;
}

/** The no-signal context — yields a zero adjustment, leaving base scoring intact. */
export const EMPTY_SIGNAL_CONTEXT: SignalContext = { salience: new Map() };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Stable partition key; `topic === null` is the global (all-topics) bucket. */
function partitionKey(topic: Topic | null): string {
  return topic ?? '*';
}

/** Log-normalize a non-negative value against a reference into ~[0, 1]. */
function normalize(value: number, ref: number): number {
  return clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(ref));
}

/**
 * Reduce a tick's observations to peak salience per topic. Each observation is
 * normalized against its source's reference, and the strongest reading in a
 * topic wins (one loud signal shouldn't be diluted by quiet ones).
 */
export function assembleSignalContext(
  observations: readonly SignalObservation[],
  refBySource: SaturationRefs,
): SignalContext {
  const salience = new Map<string, number>();

  for (const o of observations) {
    const ref = refBySource[o.source];
    // A source with no declared scale cannot be normalized — skip it rather than
    // guess. In practice the interface forces every source to declare one, so
    // this only guards malformed calls (ADR-0031).
    if (ref === undefined || ref <= 0) continue;
    const s = normalize(o.value, ref);
    const key = partitionKey(o.topic);
    salience.set(key, Math.max(salience.get(key) ?? 0, s));
  }

  return { salience };
}

/**
 * The bounded significance nudge for a cluster's topic. Prefers the exact topic
 * salience, falls back to the global (all-topics) bucket, and scales the result
 * to `[0, maxAdjustment]`. Positive-only: a quiet signal is neutral, never a
 * penalty (ADR-0025).
 */
export function signalAdjustment(
  topic: Topic,
  ctx: SignalContext,
  maxAdjustment: number,
): number {
  const salience =
    ctx.salience.get(partitionKey(topic)) ??
    ctx.salience.get(partitionKey(null)) ??
    0;
  return clamp01(salience) * Math.max(0, maxAdjustment);
}
