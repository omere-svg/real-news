import { z } from 'zod';
import type { ChatTransport } from './chat-transport.js';
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

/**
 * The Reasoner (ADR-0016): the editorial half of the model seam. Owns every
 * prompt, every result schema, and the tier choice (cheap high-volume vs. deep
 * analysis, ADR-0006). Implements `LLMClient` over any `ChatTransport`, so the
 * provider is swappable and the reasoning is unit-testable with a fake transport.
 * Wrap in `ResilientLLMClient` so a transient transport error degrades the tick.
 */
const classificationSchema = z.object({
  region: z.enum(REGIONS as [string, ...string[]]),
  topic: z.enum(TOPICS as [string, ...string[]]),
});
const sameStorySchema = z.object({ same: z.boolean() });
const adjustmentSchema = z.object({ adjustment: z.number() });

export class Reasoner implements LLMClient {
  constructor(private readonly transport: ChatTransport) {}

  async classify(input: ClassifyInput): Promise<Classification> {
    const json = await this.transport.completeJson(
      `Classify this news item. Respond with a JSON object ` +
        `{"region": "Israel"|"World", "topic": one of ${JSON.stringify(TOPICS)}}.\n\n` +
        `Region is "Israel" only if the story is primarily about Israel; otherwise "World".\n\n` +
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

  async analyze(input: AnalyzeInput): Promise<string> {
    return this.transport.complete(
      `Write a concise "why this matters" analysis (2-3 sentences) for this ` +
        `${input.region}/${input.topic} story (significance ${input.significance.toFixed(1)}/10).\n\n` +
        `Title: ${input.title}\n${input.text ? `Text: ${input.text}\n` : ''}\n` +
        `Be analytical and specific. Output only the analysis text.`,
      { tier: 'deep', maxTokens: 512 },
    );
  }

  async narrate(input: NarrateInput): Promise<string> {
    return this.transport.complete(
      `Turn the following news brief into a single-host podcast script of about ` +
        `${input.minutes} minute(s) of spoken narration. Use natural spoken flow with ` +
        `smooth transitions between stories; no bullet points, headings, or stage ` +
        `directions. Output only the script text.\n\n${input.brief}`,
      { tier: 'deep', maxTokens: 1024 },
    );
  }
}
