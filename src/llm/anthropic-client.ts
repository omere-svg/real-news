import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  AdjustInput,
  AnalyzeInput,
  Classification,
  ClassifyInput,
  LLMClient,
  StoryStub,
} from './llm-client.js';
import { REGIONS, TOPICS } from '../domain/types.js';

const classificationSchema = z.object({
  region: z.enum(REGIONS as [string, ...string[]]),
  topic: z.enum(TOPICS as [string, ...string[]]),
});
const sameStorySchema = z.object({ same: z.boolean() });
const adjustmentSchema = z.object({ adjustment: z.number() });

export interface AnthropicClientDeps {
  /** Cheap high-volume tier (ADR-0006), e.g. claude-haiku-4-5. */
  readonly cheapModel: string;
  /** Deep analysis tier (ADR-0006), e.g. claude-opus-4-8. */
  readonly deepModel: string;
  /** Injectable for testing; defaults to a real client reading ANTHROPIC_API_KEY. */
  readonly client?: Anthropic;
}

/** Extract concatenated text from a Messages response. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/** Pull the first JSON object out of model text (tolerates ``` fences / prose). */
function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`no JSON object in: ${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * The real Reasoner (ADR-0006). Tiered: cheap model for classify / confirm /
 * adjust (JSON replies validated with Zod), deep model for the Why-It-Matters
 * prose. Wrap in ResilientLLMClient so a transient API error degrades the tick
 * instead of crashing it.
 */
export class AnthropicClient implements LLMClient {
  private readonly client: Anthropic;

  constructor(private readonly deps: AnthropicClientDeps) {
    this.client = deps.client ?? new Anthropic();
  }

  private async cheapJson(prompt: string, maxTokens = 256): Promise<unknown> {
    const message = await this.client.messages.create({
      model: this.deps.cheapModel,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return parseJsonObject(textOf(message));
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    const json = await this.cheapJson(
      `Classify this news item. Reply with ONLY a JSON object ` +
        `{"region": "Israel"|"World", "topic": one of ${JSON.stringify(TOPICS)}}.\n\n` +
        `Region is "Israel" only if the story is primarily about Israel; otherwise "World".\n\n` +
        `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}`,
    );
    return classificationSchema.parse(json) as Classification;
  }

  async confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean> {
    const json = await this.cheapJson(
      `Do these two headlines describe the SAME real-world news event? ` +
        `Reply with ONLY {"same": true|false}.\n\nA: ${a.title}\nB: ${b.title}`,
      64,
    );
    return sameStorySchema.parse(json).same;
  }

  async adjustSignificance(input: AdjustInput): Promise<number> {
    const json = await this.cheapJson(
      `A news story scored ${input.baseScore.toFixed(1)}/10 from verifiable signals. ` +
        `Suggest a small editorial adjustment in [-2, 2] for intrinsic importance the ` +
        `signals may miss. Reply with ONLY {"adjustment": number}.\n\n` +
        `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}`,
      64,
    );
    return adjustmentSchema.parse(json).adjustment;
  }

  async analyze(input: AnalyzeInput): Promise<string> {
    const message = await this.client.messages.create({
      model: this.deps.deepModel,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content:
            `Write a concise "why this matters" analysis (2-3 sentences) for this ` +
            `${input.region}/${input.topic} story (significance ${input.significance.toFixed(1)}/10).\n\n` +
            `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}\n` +
            `Be analytical and specific. Output only the analysis text.`,
        },
      ],
    });
    return textOf(message);
  }
}
