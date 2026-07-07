import type { StoryReader } from './horizon-bot.js';
import type { Embedder } from '../embedding/embedder.js';
import type { ChatPreferences } from '../db/chat-preferences-repo.js';
import type { StoryContext } from '../llm/llm-client.js';
import type { Topic } from '../domain/types.js';

/**
 * Minimum cosine similarity for a Story to count as relevant chat grounding
 * (ADR-0047). Without a floor, semantic search always returns its top-k even when
 * nothing is about the question, so the model gets fed noise; below the floor we
 * fall back to top-by-significance ("here's today's news").
 */
const CHAT_MIN_SIMILARITY = 0.35;
const TOP_FALLBACK = 30;
const SEMANTIC_LIMIT = 12;

/**
 * Chat grounding retrieval, extracted from `HorizonBot` (ADR-0052): choose which
 * cached Stories ground a chat answer — semantic search over `story_vectors` when
 * an embedder + a `semanticSearch`-capable reader are wired (ADR-0045), else the
 * reader's top Stories by significance. A cohesive, independently-testable unit;
 * the discuss/web-escalation orchestration stays in the bot.
 */
export class ChatGrounding {
  constructor(
    private readonly reader: StoryReader,
    private readonly embedder: Embedder | undefined,
    private readonly defaultTopics: readonly Topic[] | undefined,
  ) {}

  /** Grounding Stories for a question, honoring the chat's topic filter. */
  async stories(prefs: ChatPreferences | null, question?: string): Promise<StoryContext[]> {
    const topics = (prefs?.topics ?? this.defaultTopics) as readonly Topic[] | undefined;
    const topicFilter = topics?.length ? { topic: topics } : {};

    const q = question?.trim();
    const search = this.reader.semanticSearch;
    const stories =
      q && this.embedder && search
        ? await this.semantic(search.bind(this.reader), q, topicFilter)
        : await this.reader.topStories({ limit: TOP_FALLBACK, ...topicFilter });

    return stories.map((s) => ({
      title: s.title,
      summary: s.summary,
      whyItMatters: s.whyItMatters,
      topic: s.topic,
      significance: s.significance,
      url: s.url,
    }));
  }

  private async semantic(
    search: NonNullable<StoryReader['semanticSearch']>,
    question: string,
    topicFilter: { topic?: readonly Topic[] },
  ): Promise<Awaited<ReturnType<StoryReader['topStories']>>> {
    const [vector] = await this.embedder!.embed([question]);
    // A missing/all-zero embedding can't rank anything (cosine is 0 everywhere).
    if (!vector || vector.length === 0 || vector.every((v) => v === 0)) {
      return this.reader.topStories({ limit: TOP_FALLBACK, ...topicFilter });
    }
    // Only ground on genuinely-relevant matches; if nothing clears the floor, fall
    // back to today's top stories rather than feeding the model noise (ADR-0047).
    const relevant = await search({ vector, limit: SEMANTIC_LIMIT, minSimilarity: CHAT_MIN_SIMILARITY, ...topicFilter });
    return relevant.length > 0 ? relevant : this.reader.topStories({ limit: TOP_FALLBACK, ...topicFilter });
  }
}
