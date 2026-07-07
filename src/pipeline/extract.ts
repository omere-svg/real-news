import type { SourceAdapter } from '../sources/source-adapter.js';
import type { RawItem, SourceId } from '../domain/types.js';
import { mapWithConcurrency } from './concurrency.js';

/** Max sources fetched concurrently. Per-host self-limits (e.g. GDELT) still
 * serialize their own calls inside the shared fetcher, so parallelism here is safe. */
const EXTRACT_CONCURRENCY = 8;

export interface SourceFailure {
  readonly source: SourceId;
  readonly error: string;
}

/** Outcome of the Extract stage — items plus per-source observability. */
export interface ExtractReport {
  readonly items: RawItem[];
  /** Sources that failed their pre-flight health check. */
  readonly skipped: SourceId[];
  /** Sources whose extract() threw — isolated, never fatal. */
  readonly failed: SourceFailure[];
}

/**
 * The first pipeline stage and the heart of the Extraction Worker (ADR-0010,
 * feature #1). Runs each Source behind its own pre-flight health check and
 * try/catch so one dead or throwing endpoint is skipped or recorded — never
 * crashing the tick (the non-blocking hygiene mandate).
 */
export async function extract(
  sources: readonly SourceAdapter[],
): Promise<ExtractReport> {
  // Run sources with bounded concurrency (ADR-0051) — health-check + extract per
  // source were fully serial, tens of network round-trips end-to-end. Order is
  // preserved (mapWithConcurrency keeps input order) so clustering stays
  // deterministic; per-source try/catch isolation is unchanged.
  type Outcome =
    | { kind: 'items'; items: RawItem[] }
    | { kind: 'skipped'; id: SourceId }
    | { kind: 'failed'; failure: SourceFailure };
  const outcomes = await mapWithConcurrency(sources, EXTRACT_CONCURRENCY, async (source): Promise<Outcome> => {
    try {
      if (!(await source.healthCheck())) return { kind: 'skipped', id: source.id };
      return { kind: 'items', items: [...(await source.extract())] };
    } catch (err) {
      return { kind: 'failed', failure: { source: source.id, error: err instanceof Error ? err.message : String(err) } };
    }
  });

  const items: RawItem[] = [];
  const skipped: SourceId[] = [];
  const failed: SourceFailure[] = [];
  for (const o of outcomes) {
    if (o.kind === 'items') items.push(...o.items);
    else if (o.kind === 'skipped') skipped.push(o.id);
    else failed.push(o.failure);
  }

  return { items, skipped, failed };
}
