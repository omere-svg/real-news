import type { RawItem, SourceId } from '../domain/types.js';

/**
 * The Source seam (ADR-0004). Every data source — Hacker News, GDELT,
 * data.gov.il, arXiv — satisfies this one interface, so adding a Source never
 * touches the pipeline. Strictly zero scraping: implementations call official
 * public APIs only.
 */
export interface SourceAdapter {
  readonly id: SourceId;

  /**
   * Non-blocking pre-flight check. Returns true if the endpoint is live.
   * MUST NOT throw — a network failure resolves to false so the master loop
   * can skip this Source without crashing (ADR-0001, feature #1 hygiene).
   */
  healthCheck(): Promise<boolean>;

  /**
   * Extract the current batch of Raw Items. MAY throw on failure; the Extract
   * stage catches per-Source errors and records them in the TickReport.
   */
  extract(): Promise<RawItem[]>;
}
