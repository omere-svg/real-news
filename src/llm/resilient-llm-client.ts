import type {
  AnalyzeInput,
  ImpactInput,
  Classification,
  ClassifyInput,
  DiscussInput,
  DiscussResult,
  FeedbackInput,
  FeedbackIntent,
  LLMClient,
  NarrateInput,
  PrefsInput,
  PrefsPatch,
  RouteInput,
  RouterIntent,
  StoryAnalysis,
  StoryStub,
} from './llm-client.js';

/**
 * Wraps any LLMClient so a Reasoner failure degrades gracefully instead of
 * crashing the tick — the same non-blocking hygiene the Source health checks
 * give extraction (ADR-0001). On error each method returns the safe, neutral
 * default and logs; the pipeline keeps running with signal-only scoring.
 */
export class ResilientLLMClient implements LLMClient {
  constructor(
    private readonly delegate: LLMClient,
    private readonly onError: (op: string, err: unknown) => void = (op, err) =>
      console.warn(`[reasoner] ${op} failed, degrading:`, err),
  ) {}

  async classify(input: ClassifyInput): Promise<Classification> {
    try {
      return await this.delegate.classify(input);
    } catch (err) {
      this.onError('classify', err);
      return { topic: 'Other' };
    }
  }

  async confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean> {
    try {
      return await this.delegate.confirmSameStory(a, b);
    } catch (err) {
      this.onError('confirmSameStory', err);
      return false; // when unsure, keep stories separate
    }
  }

  async assessImpact(input: ImpactInput): Promise<number> {
    try {
      return await this.delegate.assessImpact(input);
    } catch (err) {
      this.onError('assessImpact', err);
      return 0; // no impact signal → rely on the other deterministic axes
    }
  }

  async analyze(input: AnalyzeInput): Promise<StoryAnalysis> {
    try {
      return await this.delegate.analyze(input);
    } catch (err) {
      this.onError('analyze', err);
      return { summary: '', whyItMatters: '' }; // no analysis rather than a crash
    }
  }

  async narrate(input: NarrateInput): Promise<string> {
    try {
      return await this.delegate.narrate(input);
    } catch (err) {
      this.onError('narrate', err);
      return ''; // caller falls back to the deterministic brief (ADR-0014)
    }
  }

  async interpretFeedback(input: FeedbackInput): Promise<FeedbackIntent> {
    try {
      return await this.delegate.interpretFeedback(input);
    } catch (err) {
      this.onError('interpretFeedback', err);
      // Degrade to a no-op intent: change nothing, tell the caller it didn't land.
      return { topics: [], length: null, summary: '' };
    }
  }

  async discuss(input: DiscussInput): Promise<DiscussResult> {
    try {
      return await this.delegate.discuss(input);
    } catch (err) {
      this.onError('discuss', err);
      // Degrade to an honest non-answer; never escalate to web on an error.
      return {
        answer: "I couldn't look into that just now — please try again in a moment.",
        answeredFromNews: true,
      };
    }
  }

  async routeIntent(input: RouteInput): Promise<RouterIntent> {
    try {
      return await this.delegate.routeIntent(input);
    } catch (err) {
      this.onError('routeIntent', err);
      // Degrade to the menu: when we can't tell what they meant, show the options.
      return { action: 'help', minutes: null, topic: null };
    }
  }

  async interpretPrefs(input: PrefsInput): Promise<PrefsPatch> {
    try {
      return await this.delegate.interpretPrefs(input);
    } catch (err) {
      this.onError('interpretPrefs', err);
      // Degrade to a no-op patch: change nothing, tell the caller it didn't land.
      return { topics: null, minutes: null, summary: '' };
    }
  }
}
