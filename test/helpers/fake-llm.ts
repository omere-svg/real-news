import type {
  ImpactInput,
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
  ReflectInput,
  RouteInput,
  RouterIntent,
  StoryAnalysis,
  StoryStub,
} from '../../src/llm/llm-client.js';

export interface FakeLLMOptions {
  classify?: Classification | ((input: ClassifyInput) => Classification);
  confirm?: boolean | ((a: StoryStub, b: StoryStub) => boolean);
  /** Real-world impact in [0, 1] returned by assessImpact (ADR-0034). */
  impact?: number | ((input: ImpactInput) => number);
  /** A StoryAnalysis, or a string shorthand used as both summary and whyItMatters. */
  analyze?: StoryAnalysis | string | ((input: AnalyzeInput) => StoryAnalysis | string);
  narrate?: string | ((input: NarrateInput) => string);
  feedback?: FeedbackIntent | ((input: FeedbackInput) => FeedbackIntent);
  discuss?: DiscussResult | ((input: DiscussInput) => DiscussResult);
  route?: RouterIntent | ((input: RouteInput) => RouterIntent);
  prefs?: PrefsPatch | ((input: PrefsInput) => PrefsPatch);
  reflect?: string | ((input: ReflectInput) => string);
}

/** A deterministic LLMClient for tests, with call counters per method. */
export class FakeLLM implements LLMClient {
  classifyCalls = 0;
  confirmCalls = 0;
  impactCalls = 0;
  analyzeCalls = 0;
  narrateCalls = 0;
  feedbackCalls = 0;
  discussCalls = 0;
  routeCalls = 0;
  prefsCalls = 0;
  reflectCalls = 0;
  lastDiscuss?: DiscussInput;
  lastRoute?: RouteInput;
  lastPrefs?: PrefsInput;
  lastReflect?: ReflectInput;

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

  async assessImpact(input: ImpactInput): Promise<number> {
    this.impactCalls += 1;
    const i = this.options.impact;
    if (typeof i === 'function') return i(input);
    return i ?? 0;
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

  async reflect(input: ReflectInput): Promise<string> {
    this.reflectCalls += 1;
    this.lastReflect = input;
    const r = this.options.reflect;
    if (typeof r === 'function') return r(input);
    return r ?? `Reflection over ${input.ticks.length} ticks.`;
  }
}
