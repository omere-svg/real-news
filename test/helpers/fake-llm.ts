import type {
  AdjustInput,
  AnalyzeInput,
  Classification,
  ClassifyInput,
  FeedbackInput,
  FeedbackIntent,
  LLMClient,
  NarrateInput,
  StoryStub,
} from '../../src/llm/llm-client.js';

export interface FakeLLMOptions {
  classify?: Classification | ((input: ClassifyInput) => Classification);
  confirm?: boolean | ((a: StoryStub, b: StoryStub) => boolean);
  adjust?: number;
  analyze?: string | ((input: AnalyzeInput) => string);
  narrate?: string | ((input: NarrateInput) => string);
  feedback?: FeedbackIntent | ((input: FeedbackInput) => FeedbackIntent);
}

/** A deterministic LLMClient for tests, with call counters per method. */
export class FakeLLM implements LLMClient {
  classifyCalls = 0;
  confirmCalls = 0;
  adjustCalls = 0;
  analyzeCalls = 0;
  narrateCalls = 0;
  feedbackCalls = 0;

  constructor(private readonly options: FakeLLMOptions = {}) {}

  async classify(input: ClassifyInput): Promise<Classification> {
    this.classifyCalls += 1;
    const c = this.options.classify;
    if (typeof c === 'function') return c(input);
    return c ?? { region: 'World', topic: 'Other' };
  }

  async confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean> {
    this.confirmCalls += 1;
    const c = this.options.confirm;
    if (typeof c === 'function') return c(a, b);
    return c ?? true;
  }

  async adjustSignificance(_input: AdjustInput): Promise<number> {
    this.adjustCalls += 1;
    return this.options.adjust ?? 0;
  }

  async analyze(input: AnalyzeInput): Promise<string> {
    this.analyzeCalls += 1;
    const a = this.options.analyze;
    if (typeof a === 'function') return a(input);
    return a ?? `Why "${input.title}" matters.`;
  }

  async narrate(input: NarrateInput): Promise<string> {
    this.narrateCalls += 1;
    const n = this.options.narrate;
    if (typeof n === 'function') return n(input);
    return n ?? `Narrated (${input.minutes}m): ${input.brief}`;
  }

  async interpretFeedback(input: FeedbackInput): Promise<FeedbackIntent> {
    this.feedbackCalls += 1;
    const f = this.options.feedback;
    if (typeof f === 'function') return f(input);
    return f ?? { topics: [], regions: [], length: null, summary: '' };
  }
}
