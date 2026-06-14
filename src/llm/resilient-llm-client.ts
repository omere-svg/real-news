import type {
  AdjustInput,
  AnalyzeInput,
  Classification,
  ClassifyInput,
  LLMClient,
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
      return { region: 'World', topic: 'Other' };
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

  async adjustSignificance(input: AdjustInput): Promise<number> {
    try {
      return await this.delegate.adjustSignificance(input);
    } catch (err) {
      this.onError('adjustSignificance', err);
      return 0; // fall back to the deterministic base score
    }
  }

  async analyze(input: AnalyzeInput): Promise<string> {
    try {
      return await this.delegate.analyze(input);
    } catch (err) {
      this.onError('analyze', err);
      return '';
    }
  }
}
