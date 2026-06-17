import type { StoryRepo } from '../db/story-repo.js';
import type { LLMClient } from '../llm/llm-client.js';
import { REGIONS, type Story, type Topic } from '../domain/types.js';
import {
  budgetStories,
  type BudgetedStory,
  type Depth,
} from './budget.js';
import type { BriefRequest, QueryEngine } from './query-engine.js';

/**
 * The Presentation seam implemented (ADR-0011 / ADR-0014). Turns the
 * pre-compiled Story cache, under a time budget (ADR-0013), into user-facing
 * artifacts — never calling external services (Principle 4). Text brief and
 * topic outline are pure deterministic renders of stored Story fields; only the
 * podcast escalates to the Reasoner's `narrate`, and even that degrades to the
 * brief on failure.
 */

/** Tunables injected from config (ADR-0003) so the engine stays declarative. */
export interface QueryParams {
  /** Reading rate for text artifacts (brief, outline). */
  readonly textWordsPerMinute: number;
  /** Speaking rate for the podcast script. */
  readonly audioWordsPerMinute: number;
  /** Per-depth word cost shared by all formats (ADR-0013). */
  readonly wordCost: Record<Depth, number>;
  /** Readability floor — minimum depth every shown Story gets (ADR-0024). */
  readonly minDepth: Depth;
  /** Always show at least this many Stories, even at a tiny budget (ADR-0024). */
  readonly minStories: number;
  /** Never show more than this many Stories, regardless of budget (ADR-0024). */
  readonly maxStories: number;
  /** How many Significance-ranked Stories to pull as the candidate pool. */
  readonly candidatePool: number;
}

export interface HorizonQueryDeps {
  readonly storyRepo: StoryRepo;
  readonly llm: LLMClient;
  readonly params: QueryParams;
}

export class HorizonQuery implements QueryEngine {
  constructor(private readonly deps: HorizonQueryDeps) {}

  async textBrief(request: BriefRequest): Promise<string> {
    const selection = await this.select(
      request,
      this.deps.params.textWordsPerMinute,
    );
    return renderBrief(selection, request.minutes);
  }

  async topicOutline(topic: Topic, request: BriefRequest): Promise<string> {
    const selection = await this.select(
      { ...request, topics: [topic] },
      this.deps.params.textWordsPerMinute,
    );
    return renderOutline(topic, selection);
  }

  async podcastScript(request: BriefRequest): Promise<string> {
    const selection = await this.select(
      request,
      this.deps.params.audioWordsPerMinute,
    );
    const brief = renderBrief(selection, request.minutes);
    if (selection.length === 0) return brief;

    const script = await this.deps.llm.narrate({
      minutes: request.minutes,
      brief,
    });
    return script.trim() || brief; // degrade to the brief (ADR-0014)
  }

  /** Read a Significance-ranked pool filtered by the request, then budget it. */
  private async select(
    request: BriefRequest,
    wordsPerMinute: number,
  ): Promise<BudgetedStory[]> {
    const pool = await this.deps.storyRepo.topStories({
      limit: this.deps.params.candidatePool,
      ...(request.regions?.length ? { region: request.regions } : {}),
      ...(request.topics?.length ? { topic: request.topics } : {}),
    });
    return budgetStories(pool, request.minutes, {
      wordsPerMinute,
      wordCost: this.deps.params.wordCost,
      minDepth: this.deps.params.minDepth,
      minStories: this.deps.params.minStories,
      maxStories: this.deps.params.maxStories,
    });
  }
}

// --- Deterministic renderers (no LLM, no I/O) ---

function headlineLine(story: Story): string {
  return `• ${story.title}  (${story.significance.toFixed(1)} · ${story.region}/${story.topic})`;
}

/** Render one Story to the detail its budgeted depth allows (ADR-0013). */
function renderStory({ story, depth }: BudgetedStory): string {
  const head = headlineLine(story);
  const why = story.whyItMatters?.trim();
  if (depth === 'headline' || !why) return head;
  if (depth === 'brief') return `${head}\n  ${firstSentence(why)}`;
  return `${head}\n  ${why}`;
}

/** The first sentence of an analysis, for the mid `brief` depth. */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
}

function renderBrief(selection: BudgetedStory[], minutes: number): string {
  if (selection.length === 0) {
    return `No stories fit a ${minutes}-minute brief.`;
  }
  const noun = selection.length === 1 ? 'story' : 'stories';
  const header = `Horizon brief — ${minutes} min, ${selection.length} ${noun}`;
  return [header, '', ...selection.map(renderStory)].join('\n');
}

function renderOutline(topic: Topic, selection: BudgetedStory[]): string {
  if (selection.length === 0) {
    return `No ${topic} stories available.`;
  }
  const byRegion = new Map<string, BudgetedStory[]>();
  for (const entry of selection) {
    const bucket = byRegion.get(entry.story.region) ?? [];
    bucket.push(entry);
    byRegion.set(entry.story.region, bucket);
  }

  const sections: string[] = [`${topic} outline`, ''];
  for (const region of REGIONS) {
    const items = byRegion.get(region);
    if (!items?.length) continue;
    sections.push(`## ${region}`, ...items.map(renderStory), '');
  }
  return sections.join('\n').trimEnd();
}
