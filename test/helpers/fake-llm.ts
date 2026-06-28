import type {
  AdjustInput,
  AnalyzeInput,
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
} from '../../src/llm/llm-client.js';

export interface FakeLLMOptions {
  classify?: Classification | ((input: ClassifyInput) => Classification);
  confirm?: boolean | ((a: StoryStub, b: StoryStub) => boolean);
  adjust?: number;
  /** A StoryAnalysis, or a string shorthand used as both summary and whyItMatters. */
  analyze?: StoryAnalysis | string | ((input: AnalyzeInput) => StoryAnalysis | string);
  narrate?: string | ((input: NarrateInput) => string);
  feedback?: FeedbackIntent | ((input: FeedbackInput) => FeedbackIntent);
  discuss?: DiscussResult | ((input: DiscussInput) => DiscussResult);
  route?: RouterIntent | ((input: RouteInput) => RouterIntent);
  prefs?: PrefsPatch | ((input: PrefsInput) => PrefsPatch);
}

/** A deterministic LLMClient for tests, with call counters per method. */
export class FakeLLM implements LLMClient {
  classifyCalls = 0;
  confirmCalls = 0;
  adjustCalls = 0;
  analyzeCalls = 0;
  narrateCalls = 0;
  feedbackCalls = 0;
  discussCalls = 0;
  routeCalls = 0;
  prefsCalls = 0;
  lastDiscuss?: DiscussInput;
  lastRoute?: RouteInput;
  lastPrefs?: PrefsInput;

  constructor(private readonly options: FakeLLMOptions = {}) {}

  async classify(input: ClassifyInput): Promise<Classification> {
    this.classifyCalls += 1;
    const c = this.options.classify;
    if (typeof c === 'function') return c(input);
    return c ?? { topic: 'Other' };
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

  async analyze(input: AnalyzeInput): Promise<StoryAnalysis> {
    this.analyzeCalls += 1;
    const a = this.options.analyze;
    const resolved = typeof a === 'function' ? a(input) : a;
    if (typeof resolved === 'string') {
      return { summary: resolved, whyItMatters: resolved };
    }
    return (
      resolved ?? {
        summary: `What happened with "${input.title}".`,
        whyItMatters: `Why "${input.title}" matters.`,
      }
    );
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
    return f ?? { topics: [], length: null, summary: '' };
  }

  async discuss(input: DiscussInput): Promise<DiscussResult> {
    this.discussCalls += 1;
    this.lastDiscuss = input;
    const d = this.options.discuss;
    if (typeof d === 'function') return d(input);
    return d ?? { answer: `Answer to: ${input.question}`, answeredFromNews: true };
  }

  async routeIntent(input: RouteInput): Promise<RouterIntent> {
    this.routeCalls += 1;
    this.lastRoute = input;
    const r = this.options.route;
    if (typeof r === 'function') return r(input);
    return r ?? { action: 'help', minutes: null, topic: null };
  }

  async interpretPrefs(input: PrefsInput): Promise<PrefsPatch> {
    this.prefsCalls += 1;
    this.lastPrefs = input;
    const p = this.options.prefs;
    if (typeof p === 'function') return p(input);
    return p ?? { topics: null, minutes: null, summary: '' };
  }
}
