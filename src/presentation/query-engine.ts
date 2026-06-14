import type { Region, Topic } from '../domain/types.js';

/**
 * The Presentation seam (ADR-0011). Generates user-facing artifacts from the
 * pre-compiled Story cache — never makes real-time external calls (Principle 4).
 * Phase 1 ships the contract but NOT the implementation (see HorizonQueryStub).
 *
 * Plain reads (filter + order Stories) live on the StoryRepo read contract
 * (`StoryQuery`), which the HTTP layer already consumes directly — this seam is
 * only for the Phase-2 *generated* artifacts below.
 */
export interface QueryEngine {
  /** A concise text bullet brief within a time budget. */
  textBrief(request: BriefRequest): Promise<string>;

  /** A unified audio podcast script within a time budget. */
  podcastScript(request: BriefRequest): Promise<string>;

  /** A topic-focused outline. */
  topicOutline(topic: Topic, request: BriefRequest): Promise<string>;
}

export interface BriefRequest {
  /** User's attention budget, mapped to information density (Principle 5). */
  readonly minutes: number;
  readonly regions?: readonly Region[];
  readonly topics?: readonly Topic[];
}

/** Phase 1 stub — every method fails loudly until Phase 2 implements reads. */
export class HorizonQueryStub implements QueryEngine {
  private notImplemented(method: string): never {
    throw new Error(
      `QueryEngine.${method} is not implemented in Phase 1 (see ADR-0011).`,
    );
  }

  textBrief(): Promise<string> {
    this.notImplemented('textBrief');
  }
  podcastScript(): Promise<string> {
    this.notImplemented('podcastScript');
  }
  topicOutline(): Promise<string> {
    this.notImplemented('topicOutline');
  }
}
