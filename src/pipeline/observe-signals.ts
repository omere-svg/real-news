import type { SignalSource } from '../sources/signal-source.js';
import type { SignalObservation, SourceId } from '../domain/types.js';
import type { SourceFailure } from './extract.js';
import { mapWithConcurrency } from './concurrency.js';

const OBSERVE_CONCURRENCY = 8;

/** Outcome of collecting numeric Signals — observations plus per-source health. */
export interface SignalReport {
  readonly observations: SignalObservation[];
  /** Signal sources that failed their pre-flight health check. */
  readonly skipped: SourceId[];
  /** Signal sources whose observe() threw — isolated, never fatal. */
  readonly failed: SourceFailure[];
}

/**
 * The Signal sibling of `extract` (ADR-0025). Runs each Signal source behind its
 * own health check and try/catch, so a dead or throwing feed is skipped or
 * recorded — never crashing the tick. Observations feed significance in-tick.
 */
export async function observeSignals(
  sources: readonly SignalSource[],
): Promise<SignalReport> {
  // Bounded-concurrency, order-preserving, per-source isolated (ADR-0051) — mirrors
  // `extract`. A throwing health check is now isolated as a failure, not fatal.
  type Outcome =
    | { kind: 'obs'; obs: SignalObservation[] }
    | { kind: 'skipped'; id: SourceId }
    | { kind: 'failed'; failure: SourceFailure };
  const outcomes = await mapWithConcurrency(sources, OBSERVE_CONCURRENCY, async (source): Promise<Outcome> => {
    try {
      if (!(await source.healthCheck())) return { kind: 'skipped', id: source.id };
      return { kind: 'obs', obs: [...(await source.observe())] };
    } catch (err) {
      return { kind: 'failed', failure: { source: source.id, error: err instanceof Error ? err.message : String(err) } };
    }
  });

  const observations: SignalObservation[] = [];
  const skipped: SourceId[] = [];
  const failed: SourceFailure[] = [];
  for (const o of outcomes) {
    if (o.kind === 'obs') observations.push(...o.obs);
    else if (o.kind === 'skipped') skipped.push(o.id);
    else failed.push(o.failure);
  }

  return { observations, skipped, failed };
}
