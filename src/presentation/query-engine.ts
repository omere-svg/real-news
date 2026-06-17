import type { Region, Topic } from '../domain/types.js';

/**
 * The Presentation seam (ADR-0011). Generates user-facing artifacts from the
 * pre-compiled Story cache — never makes real-time external calls (Principle 4).
 * Implemented by `HorizonQuery` (ADR-0014); plain Story reads (filter + order)
 * live on the StoryRepo read contract (`StoryQuery`), which the HTTP layer
 * consumes directly — this seam is only for the *generated* artifacts below.
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
