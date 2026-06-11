import type { SourceAdapter } from '../sources/source-adapter.js';
import type { RawItem, SourceId } from '../domain/types.js';

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
  const items: RawItem[] = [];
  const skipped: SourceId[] = [];
  const failed: SourceFailure[] = [];

  for (const source of sources) {
    if (!(await source.healthCheck())) {
      skipped.push(source.id);
      continue;
    }
    try {
      items.push(...(await source.extract()));
    } catch (err) {
      failed.push({
        source: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { items, skipped, failed };
}
