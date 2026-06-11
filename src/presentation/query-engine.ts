import type { Region, Story, Topic } from '../domain/types.js';

/**
 * The Presentation seam (ADR-0011). Read-only viewer over finalized Stories.
 * Phase 1 ships the contract but NOT the implementation — see HorizonQueryStub.
 * It must never make real-time external calls (Principle 4): it reads the
 * pre-compiled cache only.
 */
export interface QueryEngine {
  /** Top Stories matching a filter, ordered by Significance descending. */
  topStories(filter: StoryFilter): Promise<Story[]>;

  /** A concise text bullet brief within a time budget. */
  textBrief(request: BriefRequest): Promise<string>;

  /** A unified audio podcast script within a time budget. */
  podcastScript(request: BriefRequest): Promise<string>;

  /** A topic-focused outline. */
  topicOutline(topic: Topic, request: BriefRequest): Promise<string>;
}

export interface StoryFilter {
  readonly region?: Region;
  readonly topic?: Topic;
  /** Minimum Significance to include. */
  readonly minSignificance?: number;
  readonly limit?: number;
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

  topStories(): Promise<Story[]> {
    this.notImplemented('topStories');
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
