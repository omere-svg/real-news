import OpenAI from 'openai';
import { z } from 'zod';
import type {
  AdjustInput,
  AnalyzeInput,
  Classification,
  ClassifyInput,
  LLMClient,
  NarrateInput,
  StoryStub,
} from './llm-client.js';
import { REGIONS, TOPICS } from '../domain/types.js';

const classificationSchema = z.object({
  region: z.enum(REGIONS as [string, ...string[]]),
  topic: z.enum(TOPICS as [string, ...string[]]),
});
const sameStorySchema = z.object({ same: z.boolean() });
const adjustmentSchema = z.object({ adjustment: z.number() });

export interface OpenAIClientDeps {
  /** Cheap high-volume tier (the Reasoner seam, ADR-0006/0012), e.g. gpt-4o-mini. */
  readonly cheapModel: string;
  /** Deep analysis tier, e.g. gpt-4o. */
  readonly deepModel: string;
  /** Injectable for testing; defaults to a real client reading OPENAI_API_KEY. */
  readonly client?: OpenAI;
}

/**
 * The Reasoner backed by OpenAI (ADR-0012). Tiered: cheap model for classify /
 * confirm / adjust (JSON mode, validated with Zod), deep model for the
 * Why-It-Matters prose. Wrap in ResilientLLMClient so a transient API error
 * degrades the tick instead of crashing it.
 */
export class OpenAIClient implements LLMClient {
  private readonly client: OpenAI;

  constructor(private readonly deps: OpenAIClientDeps) {
    // Fall back to a placeholder key so a missing key degrades at call time
    // (via ResilientLLMClient) instead of throwing at construction.
    this.client =
      deps.client ??
      new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? 'missing' });
  }

  private async json(prompt: string, maxTokens = 256): Promise<unknown> {
    const res = await this.client.chat.completions.create({
      model: this.deps.cheapModel,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('openai: empty response');
    return JSON.parse(content);
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    const json = await this.json(
      `Classify this news item. Respond with a JSON object ` +
        `{"region": "Israel"|"World", "topic": one of ${JSON.stringify(TOPICS)}}.\n\n` +
        `Region is "Israel" only if the story is primarily about Israel; otherwise "World".\n\n` +
        `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}`,
    );
    return classificationSchema.parse(json) as Classification;
  }

  async confirmSameStory(a: StoryStub, b: StoryStub): Promise<boolean> {
    const json = await this.json(
      `Do these two headlines describe the SAME real-world news event? ` +
        `Respond with a JSON object {"same": true|false}.\n\nA: ${a.title}\nB: ${b.title}`,
      64,
    );
    return sameStorySchema.parse(json).same;
  }

  async adjustSignificance(input: AdjustInput): Promise<number> {
    const json = await this.json(
      `A news story scored ${input.baseScore.toFixed(1)}/10 from verifiable signals. ` +
        `Suggest a small editorial adjustment in [-2, 2] for intrinsic importance the ` +
        `signals may miss. Respond with a JSON object {"adjustment": number}.\n\n` +
        `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}`,
      64,
    );
    return adjustmentSchema.parse(json).adjustment;
  }

  async analyze(input: AnalyzeInput): Promise<string> {
    const res = await this.client.chat.completions.create({
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
    return (res.choices[0]?.message?.content ?? '').trim();
  }

  async narrate(input: NarrateInput): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.deps.deepModel,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content:
            `Turn the following news brief into a single-host podcast script of about ` +
            `${input.minutes} minute(s) of spoken narration. Use natural spoken flow with ` +
            `smooth transitions between stories; no bullet points, headings, or stage ` +
            `directions. Output only the script text.\n\n${input.brief}`,
        },
      ],
    });
    return (res.choices[0]?.message?.content ?? '').trim();
  }
}
