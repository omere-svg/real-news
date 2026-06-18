import type { SignalSource } from '../sources/signal-source.js';
import type { SignalObservation, SourceId } from '../domain/types.js';
import type { SourceFailure } from './extract.js';

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
  const observations: SignalObservation[] = [];
  const skipped: SourceId[] = [];
  const failed: SourceFailure[] = [];

  for (const source of sources) {
    if (!(await source.healthCheck())) {
      skipped.push(source.id);
      continue;
    }
    try {
      observations.push(...(await source.observe()));
    } catch (err) {
      failed.push({
        source: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { observations, skipped, failed };
}
