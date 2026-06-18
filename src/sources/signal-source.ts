import type { SignalObservation, SourceId } from '../domain/types.js';

/**
 * The Signal seam (ADR-0025), sibling to `SourceAdapter` (ADR-0004). A Signal
 * source emits numeric series — reader-attention, macro indicators — that feed
 * significance as scoring context, never a standalone Story. Keeping it separate
 * from the Story seam means numeric data never touches the classify/cluster
 * pipeline. Strictly zero scraping: implementations call official public APIs only.
 */
export interface SignalSource {
  readonly id: SourceId;

  /**
   * Non-blocking pre-flight check — true if the endpoint is live. MUST NOT throw
   * (a network failure resolves false so the tick can skip this source cleanly),
   * mirroring `SourceAdapter` hygiene.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Read the current batch of numeric observations. MAY throw on failure; the
   * caller isolates per-source errors so one bad feed never crashes the tick.
   */
  observe(): Promise<SignalObservation[]>;
}
