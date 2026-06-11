import type {
  AdjustInput,
  AnalyzeInput,
  Classification,
  ClassifyInput,
  LLMClient,
  StoryStub,
} from '../../src/llm/llm-client.js';

export interface FakeLLMOptions {
  classify?: Classification | ((input: ClassifyInput) => Classification);
  confirm?: boolean | ((a: StoryStub, b: StoryStub) => boolean);
  adjust?: number;
  analyze?: string | ((input: AnalyzeInput) => string);
}

/** A deterministic LLMClient for tests, with call counters per method. */
export class FakeLLM implements LLMClient {
  classifyCalls = 0;
  confirmCalls = 0;
  adjustCalls = 0;
  analyzeCalls = 0;

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
}
