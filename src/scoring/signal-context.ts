import type { SignalObservation, SourceId, Topic } from '../domain/types.js';
import { clamp01, normalize } from './normalize.js';

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
  /**
   * Salience ∈ [0, 1] per normalized real-world entity (ADR-0043), so a Story
   * whose named entities match a high-traffic Pageviews article gets a targeted
   * nudge — not just its whole Topic. Empty when no source emits entities.
   */
  readonly entitySalience: ReadonlyMap<string, number>;
}

/** The no-signal context — yields a zero adjustment, leaving base scoring intact. */
export const EMPTY_SIGNAL_CONTEXT: SignalContext = {
  salience: new Map(),
  entitySalience: new Map(),
};

/** Stable partition key; `topic === null` is the global (all-topics) bucket. */
function partitionKey(topic: Topic | null): string {
  return topic ?? '*';
}

/**
 * Trend enrichment (ADR-0044): compare each observation to its own prior stored
 * reading and lift a **rising** series' salience by up to `trendBoost`. A flat or
 * falling series is untouched (positive-only, like the base nudge). `priorByKey`
 * is the latest value stored for each series *before* this tick.
 */
export interface TrendOptions {
  /** The most recent prior value per observation `key` (from persisted history). */
  readonly priorByKey?: ReadonlyMap<string, number>;
  /** Max fractional salience lift for a fully-rising series, e.g. 0.5. Absent ⇒ off. */
  readonly trendBoost?: number;
  /** [0, 1] weight on entity-level salience (ADR-0043); 0/absent ⇒ don't index entities. */
  readonly entityWeight?: number;
}

/** The fraction [0, 1] by which `value` rose over `prior` (0 when not rising). */
function riseFraction(value: number, prior: number | undefined): number {
  if (prior === undefined || value <= prior || value <= 0) return 0;
  return clamp01((value - prior) / value);
}

/**
 * Reduce a tick's observations to peak salience per topic. Each observation is
 * normalized against its source's reference, optionally lifted when the series is
 * rising vs. its prior reading (ADR-0044), and the strongest reading in a topic
 * wins (one loud signal shouldn't be diluted by quiet ones).
 */
export function assembleSignalContext(
  observations: readonly SignalObservation[],
  refBySource: SaturationRefs,
  trend: TrendOptions = {},
): SignalContext {
  const salience = new Map<string, number>();
  const entitySalience = new Map<string, number>();
  const boost = Math.max(0, trend.trendBoost ?? 0);
  const entityWeight = Math.max(0, trend.entityWeight ?? 0);

  for (const o of observations) {
    const ref = refBySource[o.source];
    // A source with no declared scale cannot be normalized — skip it rather than
    // guess. In practice the interface forces every source to declare one, so
    // this only guards malformed calls (ADR-0031).
    if (ref === undefined || ref <= 0) continue;
    let s = normalize(o.value, ref);
    if (boost > 0 && trend.priorByKey) {
      s = clamp01(s * (1 + boost * riseFraction(o.value, trend.priorByKey.get(o.key))));
    }
    const key = partitionKey(o.topic);
    salience.set(key, Math.max(salience.get(key) ?? 0, s));

    // Index entity-level salience so scoring can nudge a specific matching Story
    // (ADR-0043). Scaled by entityWeight; skipped entirely when disabled.
    if (entityWeight > 0 && o.entity) {
      const e = o.entity.trim().toLowerCase();
      if (e) entitySalience.set(e, Math.max(entitySalience.get(e) ?? 0, s * entityWeight));
    }
  }

  return { salience, entitySalience };
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

/**
 * The entity-level nudge for a Story (ADR-0043): the strongest entity salience
 * among the Story's own named entities, scaled to `[0, maxAdjustment]`. Lets a
 * spike in attention on a *specific* person/place lift that story alone, not its
 * whole Topic. Zero when nothing matches (positive-only, like the partition nudge).
 */
export function entityAdjustment(
  entities: ReadonlySet<string>,
  ctx: SignalContext,
  maxAdjustment: number,
): number {
  let best = 0;
  for (const e of entities) {
    const s = ctx.entitySalience.get(e);
    if (s !== undefined && s > best) best = s;
  }
  return clamp01(best) * Math.max(0, maxAdjustment);
}
