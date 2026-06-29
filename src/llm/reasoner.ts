import { z } from 'zod';
import type { ChatTransport } from './chat-transport.js';
import type {
  AdjustInput,
  AnalyzeInput,
  Classification,
  ClassifyInput,
  ConversationTurn,
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
  StoryContext,
  StoryStub,
  WebContext,
} from './llm-client.js';
import { TOPICS, type Topic } from '../domain/types.js';
import { canonical } from '../domain/vocab.js';

/**
 * The Reasoner (ADR-0016): the editorial half of the model seam. Owns every
 * prompt, every result schema, and the tier choice (cheap high-volume vs. deep
 * analysis, ADR-0006). Implements `LLMClient` over any `ChatTransport`, so the
 * provider is swappable and the reasoning is unit-testable with a fake transport.
 * Wrap in `ResilientLLMClient` so a transient transport error degrades the tick.
 */
const classificationSchema = z.object({
  topic: z.enum(TOPICS as [string, ...string[]]),
});
const sameStorySchema = z.object({ same: z.boolean() });
const adjustmentSchema = z.object({ adjustment: z.number() });
const analysisSchema = z.object({
  summary: z.string().default(''),
  whyItMatters: z.string().default(''),
});
const discussSchema = z.object({
  answer: z.string().default(''),
  answeredFromNews: z.boolean().default(false),
});

// Lenient by design: an unrecognised action degrades to "help" rather than
// throwing, and topic is a free string validated downstream (ADR-0030).
const routerActionSchema = z
  .enum([
    'brief',
    'outline',
    'podcast',
    'question',
    'prefs',
    'setPrefs',
    'clearPrefs',
    'feedback',
    'remember',
    'forget',
    'help',
  ])
  .catch('help');
const routerIntentSchema = z.object({
  action: routerActionSchema.default('help'),
  minutes: z.number().positive().nullable().catch(null).default(null),
  topic: z.string().nullable().catch(null).default(null),
});

// Lenient: topic values are free strings, filtered to the controlled
// vocabulary by the bot — an unknown name is dropped, never a parse failure.
const prefsListChangeSchema = z.object({
  mode: z.enum(['replace', 'add', 'remove']).catch('replace'),
  values: z.array(z.string()).default([]),
});
const prefsPatchSchema = z.object({
  topics: prefsListChangeSchema.nullable().catch(null).default(null),
  minutes: z.number().positive().nullable().catch(null).default(null),
  summary: z.string().default(''),
});

const weightDirectionSchema = z.enum(['more', 'less', 'mute', 'reset']);
const lengthDirectionSchema = z.enum(['shorter', 'longer', 'reset']);
// Lenient: topic is a free string here, then filtered to the controlled
// vocabulary below — an unknown name is dropped, never a parse failure (ADR-0026).
const feedbackIntentSchema = z.object({
  topics: z.array(z.object({ topic: z.string(), direction: weightDirectionSchema })).default([]),
  length: lengthDirectionSchema.nullable().default(null),
  summary: z.string().default(''),
});

/** A prompt preamble carrying the user's personal context, or "" (ADR-0028). */
function memoryBlock(memory: string | undefined): string {
  const m = memory?.trim();
  return m ? `READER CONTEXT (tailor to this, do not quote it verbatim):\n${m}\n\n` : '';
}

/** Render prior conversation turns as a compact transcript (ADR-0029). */
function historyBlock(history: readonly ConversationTurn[]): string {
  if (history.length === 0) return '';
  const lines = history.map(
    (t) => `${t.role === 'user' ? 'Reader' : 'Horizon'}: ${t.content}`,
  );
  return `CONVERSATION SO FAR:\n${lines.join('\n')}\n\n`;
}

/** Render the cache Stories as numbered grounding context (ADR-0029). */
function storyContextBlock(stories: readonly StoryContext[]): string {
  if (stories.length === 0) return '(no relevant stories in the cache)';
  return stories
    .map((s, i) => {
      const why = s.whyItMatters?.trim();
      return (
        `${i + 1}. [${s.topic}, significance ${s.significance.toFixed(1)}] ${s.title}` +
        (why ? `\n   ${why}` : '') +
        (s.url ? `\n   ${s.url}` : '')
      );
    })
    .join('\n');
}

/** Render web search hits as numbered grounding context (ADR-0029). */
function webContextBlock(web: readonly WebContext[]): string {
  return web
    .map((w, i) => `${i + 1}. ${w.title}\n   ${w.snippet}\n   ${w.url}`)
    .join('\n');
}

export class Reasoner implements LLMClient {
  constructor(private readonly transport: ChatTransport) {}

  async classify(input: ClassifyInput): Promise<Classification> {
    const json = await this.transport.completeJson(
      `Classify this news item. Respond with a JSON object ` +
        `{"topic": one of ${JSON.stringify(TOPICS)}}.\n\n` +
        `Use "Israel" when the story is primarily about Israel (its politics, society, ` +
        `economy, or security), even if it also touches another subject — place wins. ` +
        `Otherwise pick the best subject; use "Other" only when nothing fits.\n\n` +
        `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}`,
      { tier: 'cheap', maxTokens: 256 },
    );
    return classificationSchema.parse(json) as Classification;
  }

  async confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean> {
    const json = await this.transport.completeJson(
      `Do these two headlines describe the SAME real-world news event? ` +
        `Respond with a JSON object {"same": true|false}.\n\nA: ${a.title}\nB: ${b.title}`,
      { tier: 'cheap', maxTokens: 64 },
    );
    return sameStorySchema.parse(json).same;
  }

  async adjustSignificance(input: AdjustInput): Promise<number> {
    const json = await this.transport.completeJson(
      `A news story scored ${input.baseScore.toFixed(1)}/10 from verifiable signals. ` +
        `Suggest a small editorial adjustment in [-2, 2] for intrinsic importance the ` +
        `signals may miss. Respond with a JSON object {"adjustment": number}.\n\n` +
        `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}`,
      { tier: 'cheap', maxTokens: 64 },
    );
    return adjustmentSchema.parse(json).adjustment;
  }

  async analyze(input: AnalyzeInput): Promise<StoryAnalysis> {
    const json = await this.transport.completeJson(
      `You are a wire-service editor. Read this ${input.topic} item and ` +
        `return JSON {"summary": ..., "whyItMatters": ...}.\n\n` +
        `summary: 1-2 short, concrete sentences stating exactly what happened — who did what, ` +
        `with the key specifics (names, numbers, dates). Write a plain factual news lede a ` +
        `reader understands on its own. No analysis, no hype adjectives. If the item gives ` +
        `only a title with no body, summarize just what the title states — never invent facts.\n` +
        `whyItMatters: ONE short sentence (max ~25 words) naming the concrete consequence or ` +
        `stake. Be specific. Never use filler such as "paradigm shift", "pivotal", ` +
        `"underscores", "signifies", "highlights the importance of", or "represents a ... ` +
        `advancement".\n\n` +
        `Title: ${input.title}\n${input.text ? `Body: ${input.text}\n` : ''}`,
      { tier: 'deep', maxTokens: 400 },
    );
    return analysisSchema.parse(json);
  }

  async narrate(input: NarrateInput): Promise<string> {
    const lengthRule = input.targetWords
      ? `Write approximately ${input.targetWords} words — this matters: the script is read ` +
        `aloud at a steady pace and must fill the full ${input.minutes} minute(s). Give each ` +
        `story enough depth (two to four sentences) plus natural transitions to reach that ` +
        `length; do not be overly brief or end early. `
      : `of about ${input.minutes} minute(s) of spoken narration. `;
    // Scale the output ceiling to the target so long podcasts aren't truncated (~2 tokens/word).
    const maxTokens = Math.min(4096, Math.round((input.targetWords ?? input.minutes * 150) * 2) + 256);
    return this.transport.complete(
      `Turn the following news brief into a single-host podcast script. ${lengthRule}` +
        `Open with a one-line intro. Then cover each story in the same structure: state the ` +
        `headline, give one or two sentences on what happened, then one sentence on why it ` +
        `matters — joined by smooth spoken transitions. Close with a brief sign-off. Do not ` +
        `read out URLs, emoji, bullet characters, headings, or stage directions. Output only ` +
        `the script text.\n\n` +
        memoryBlock(input.memory) +
        input.brief,
      { tier: 'deep', maxTokens },
    );
  }

  async discuss(input: DiscussInput): Promise<DiscussResult> {
    const json = await this.transport.completeJson(
      `You are Horizon, a news assistant discussing the day's stories with a reader. ` +
        `Answer their question conversationally and concisely.\n\n` +
        `Ground your answer in the NEWS CONTEXT below` +
        (input.web ? ` and the WEB RESULTS` : '') +
        `. If the answer is not supported by the provided material, say so plainly ` +
        `instead of inventing facts.\n\n` +
        `Respond with a JSON object {"answer": <your reply>, "answeredFromNews": ` +
        `<true if the provided news/web actually contained the answer, else false>}.\n\n` +
        memoryBlock(input.memory) +
        historyBlock(input.history) +
        `NEWS CONTEXT:\n${storyContextBlock(input.stories)}\n` +
        (input.web ? `\nWEB RESULTS:\n${webContextBlock(input.web)}\n` : '') +
        `\nQUESTION: ${input.question}`,
      { tier: 'deep', maxTokens: 700 },
    );
    return discussSchema.parse(json);
  }

  async interpretFeedback(input: FeedbackInput): Promise<FeedbackIntent> {
    const json = await this.transport.completeJson(
      `Interpret a news reader's free-text feedback into preference changes. ` +
        `Respond with a JSON object: ` +
        `{"topics":[{"topic":<one of ${JSON.stringify(TOPICS)}>,"direction":"more"|"less"|"mute"|"reset"}], ` +
        `"length":"shorter"|"longer"|"reset"|null, ` +
        `"summary":<one short sentence confirming what you understood>}.\n\n` +
        `Use "more"/"less" for emphasis, "mute" to hide a topic entirely, "reset" to clear a ` +
        `prior bias. Set "length" only if they comment on brief length. Only use the listed ` +
        `Topics; omit anything you can't map. Keep the summary friendly and concrete.\n\n` +
        `Feedback: ${input.text}`,
      { tier: 'cheap', maxTokens: 384 },
    );

    const parsed = feedbackIntentSchema.parse(json);
    // Drop entries outside the controlled vocabulary (ADR-0026).
    const topics = parsed.topics
      .map((t) => ({ topic: canonical(TOPICS as readonly Topic[], t.topic), direction: t.direction }))
      .filter((t): t is { topic: Topic; direction: typeof t.direction } => t.topic !== null);

    return { topics, length: parsed.length, summary: parsed.summary };
  }

  async routeIntent(input: RouteInput): Promise<RouterIntent> {
    const json = await this.transport.completeJson(
      `You route a news reader's message to ONE action for Horizon, a news ` +
        `assistant. Pick the single best fit.\n\n` +
        `Actions:\n` +
        `- "brief": they want a quick news brief / summary / catch-up. Set "minutes" if they name a time budget.\n` +
        `- "outline": they want a deep dive on ONE subject. Set "topic" to one of ${JSON.stringify(TOPICS)} and "minutes" if named.\n` +
        `- "podcast": they want spoken / audio news to listen to.\n` +
        `- "question": they ask a specific question about the news or current events.\n` +
        `- "prefs": they want to SEE their current settings / preferences.\n` +
        `- "setPrefs": they want to CHANGE which topics they follow or their default minutes ` +
        `(e.g. "add Politics", "only AI and Israel", "set my budget to 5 minutes").\n` +
        `- "clearPrefs": they want to RESET / clear all their preferences back to default.\n` +
        `- "feedback": they want to fine-tune emphasis without a hard filter (more/less of something, shorter/longer).\n` +
        `- "remember": they share personal context for you to keep in mind.\n` +
        `- "forget": they want you to drop what you remember about them.\n` +
        `- "help": greetings, "what can you do", a menu request, or anything unclear.\n\n` +
        `Respond with a JSON object ` +
        `{"action": <one action>, "minutes": <positive number or null>, "topic": <one Topic or null>}.\n\n` +
        `Message: ${input.text}`,
      { tier: 'cheap', maxTokens: 128 },
    );
    const parsed = routerIntentSchema.parse(json);
    return { action: parsed.action, minutes: parsed.minutes, topic: parsed.topic };
  }

  async interpretPrefs(input: PrefsInput): Promise<PrefsPatch> {
    const json = await this.transport.completeJson(
      `Interpret a news reader's request to change their hard preference filters. ` +
        `Respond with a JSON object: ` +
        `{"topics": {"mode":"replace"|"add"|"remove","values":[<Topics>]} | null, ` +
        `"minutes": <positive number or null>, ` +
        `"summary": <one short sentence confirming what you understood>}.\n\n` +
        `Use "replace" to set exactly the listed values, "add" to include them alongside ` +
        `current ones (e.g. "also add Politics"), "remove" to drop them. Set "minutes" only ` +
        `when they name a default time budget. Only use these Topics ${JSON.stringify(TOPICS)}; ` +
        `omit anything you can't map. Leave a field null ` +
        `if the request doesn't touch it.\n\n` +
        `Request: ${input.text}`,
      { tier: 'cheap', maxTokens: 384 },
    );
    return prefsPatchSchema.parse(json);
  }
}
