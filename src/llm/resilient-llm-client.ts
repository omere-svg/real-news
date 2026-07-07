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
  ReflectInput,
  Reflection,
  RouteInput,
  RouterIntent,
  StoryAnalysis,
  StoryStub,
  TranslateInput,
  Translation,
} from './llm-client.js';
import type { SpendBudget } from './spend-guard.js';

/**
 * Wraps any LLMClient so a Reasoner failure degrades gracefully instead of
 * crashing the tick — the same non-blocking hygiene the Source health checks give
 * extraction (ADR-0001). Each method delegates through one generic `guard`, so the
 * degradation policy is declared once per method as *data* (the neutral fallback),
 * not repeated as try/catch boilerplate (ADR-0052). On error it logs and returns
 * the fallback; the pipeline keeps running with signal-only scoring.
 *
 * It is ALSO the enforcement point for the daily spend ceiling (ADR-0062): when
 * the optional `budget` reports the day's estimated model spend has hit the
 * configured cap, every call short-circuits to its neutral fallback WITHOUT
 * touching the network — the same degrade path a transport failure takes, so the
 * pipeline and bot keep serving deterministic output instead of running an
 * unbounded bill. The cap is deliberately set very high; this is a runaway
 * backstop, not a normal-operation throttle.
 */
export class ResilientLLMClient implements LLMClient {
  constructor(
    private readonly delegate: LLMClient,
    // Composition root wires the real Logger-backed callback (main.ts); this
    // default only covers callers (tests) that don't care about the degrade log.
    private readonly onError: (op: string, err: unknown) => void = () => undefined,
    /** Optional daily spend ceiling (ADR-0062); absent ⇒ never budget-gated. */
    private readonly budget?: SpendBudget,
  ) {}

  /** Run a delegate call; on failure — or when over the daily spend cap — log and
   * return the neutral fallback without hitting the network. */
  private guard<T>(op: string, call: (d: LLMClient) => Promise<T>, fallback: T): Promise<T> {
    if (this.budget?.isExhausted()) {
      this.onError(op, new Error('daily model spend cap reached — degrading (ADR-0062)'));
      return Promise.resolve(fallback);
    }
    return call(this.delegate).catch((err) => {
      this.onError(op, err);
      return fallback;
    });
  }

  classify(input: ClassifyInput): Promise<Classification> {
    return this.guard('classify', (d) => d.classify(input), { topic: 'Other' });
  }

  confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean> {
    // When unsure, keep stories separate.
    return this.guard('confirmSameStory', (d) => d.confirmSameStory(a, b), false);
  }

  assessImpact(input: ImpactInput): Promise<number> {
    // No impact signal → rely on the other deterministic axes.
    return this.guard('assessImpact', (d) => d.assessImpact(input), 0);
  }

  analyze(input: AnalyzeInput): Promise<StoryAnalysis> {
    // Null (not '') so the upsert preserves any existing summary/why/displayTitle (ADR-0047/Task 20).
    return this.guard('analyze', (d) => d.analyze(input), {
      summary: null,
      whyItMatters: null,
      displayTitle: null,
    });
  }

  translateToEnglish(input: TranslateInput): Promise<Translation> {
    // Null (not '') so the upsert preserves any existing displayTitle/summary
    // and the raw title stays the fallback on a transport failure (ADR-0047/0057).
    return this.guard('translateToEnglish', (d) => d.translateToEnglish(input), {
      displayTitle: null,
      summary: null,
    });
  }

  narrate(input: NarrateInput): Promise<string> {
    // Caller falls back to the deterministic brief (ADR-0014).
    return this.guard('narrate', (d) => d.narrate(input), '');
  }

  interpretFeedback(input: FeedbackInput): Promise<FeedbackIntent> {
    // No-op intent: change nothing, tell the caller it didn't land.
    return this.guard('interpretFeedback', (d) => d.interpretFeedback(input), {
      topics: [],
      length: null,
      summary: '',
    });
  }

  discuss(input: DiscussInput): Promise<DiscussResult> {
    // Honest non-answer; never escalate to web on an error.
    return this.guard('discuss', (d) => d.discuss(input), {
      answer: "I couldn't look into that just now — please try again in a moment.",
      answeredFromNews: true,
    });
  }

  routeIntent(input: RouteInput): Promise<RouterIntent> {
    // Can't tell what they meant → show the menu.
    return this.guard('routeIntent', (d) => d.routeIntent(input), {
      action: 'help',
      minutes: null,
    });
  }

  interpretPrefs(input: PrefsInput): Promise<PrefsPatch> {
    // No-op patch: change nothing, tell the caller it didn't land.
    return this.guard('interpretPrefs', (d) => d.interpretPrefs(input), {
      topics: null,
      minutes: null,
      summary: '',
    });
  }

  reflect(input: ReflectInput): Promise<Reflection> {
    // An advisory failure is non-critical; skip this cycle's reflection —
    // and never let a degraded reflection propose actions (ADR-0053).
    return this.guard('reflect', (d) => d.reflect(input), { advisory: '', actions: [] });
  }
}
