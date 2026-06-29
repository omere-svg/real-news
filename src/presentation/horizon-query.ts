import type { StoryRepo } from '../db/story-repo.js';
import type { Narrator } from '../llm/llm-client.js';
import type { Story, Topic } from '../domain/types.js';
import {
  budgetStories,
  type BudgetedStory,
  type Depth,
} from './budget.js';
import type { BriefRequest, QueryEngine } from './query-engine.js';
import { scoreExplanation } from './score-explanation.js';

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
  /** Only the podcast path touches the model — narrate, nothing else (ADR-0014). */
  readonly llm: Narrator;
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
      // Aim the spoken length at the budget so the audio actually fills the minutes.
      targetWords: Math.round(request.minutes * this.deps.params.audioWordsPerMinute),
      brief,
      ...(request.memory ? { memory: request.memory } : {}),
    });
    return script.trim() || brief; // degrade to the brief (ADR-0014)
  }

  /**
   * Read a Significance-ranked pool (hard-filtered by any explicit request
   * topic), drop muted topics, and budget it under a preference-weighted
   * priority (ADR-0026). Significance stays global; weighting is per-user
   * Presentation — the displayed score is never altered, only the ordering.
   */
  private async select(
    request: BriefRequest,
    wordsPerMinute: number,
  ): Promise<BudgetedStory[]> {
    const pool = await this.deps.storyRepo.topStories({
      limit: this.deps.params.candidatePool,
      ...(request.topics?.length ? { topic: request.topics } : {}),
    });

    const tw = request.topicWeights;
    const weighted = Boolean(tw);
    const rank = (s: Story): number => s.significance * (tw?.[s.topic] ?? 1);
    // Muted topics (weight 0 ⇒ rank 0) are excluded entirely.
    const candidates = weighted ? pool.filter((s) => rank(s) > 0) : pool;

    return budgetStories(candidates, request.minutes, {
      wordsPerMinute,
      wordCost: this.deps.params.wordCost,
      minDepth: this.deps.params.minDepth,
      minStories: this.deps.params.minStories,
      maxStories: this.deps.params.maxStories,
      ...(weighted ? { rank } : {}),
    });
  }
}

// --- Deterministic renderers (no LLM, no I/O) ---

/**
 * Render one Story as a consistent, scannable block (ADR-0024 readability):
 *   📰 <headline>
 *   <what-happened summary>              (the factual recap; brief+ depth)
 *   💡 <why it matters>                  (the editorial description; full depth)
 *   🏷 <topic · significance>            (the short descriptor)
 *   🔗 <source link>                     (provenance, ADR-0027)
 * `headline` depth shows only the headline, descriptor, and link; `brief` adds the
 * factual summary (trimmed to two sentences); `full` adds the why-it-matters
 * description. The link is the Story's canonical `url`.
 */
function renderStory({ story, depth }: BudgetedStory): string {
  const lines = [`📰 ${story.title}`];
  if (depth !== 'headline') {
    const summary = story.summary?.trim();
    if (summary) {
      lines.push(depth === 'brief' ? firstSentences(summary, 2) : summary);
    }
    if (depth === 'full') {
      const why = story.whyItMatters?.trim();
      if (why) lines.push(`💡 ${why}`);
    }
  }
  lines.push(descriptorLine(story));
  const src = sourceLine(story);
  if (src) lines.push(src);
  return lines.join('\n');
}

/** The short descriptor: topic + significance + a compact score rationale. */
function descriptorLine(story: Story): string {
  return `🏷 ${story.topic} · significance ${story.significance.toFixed(1)}${scoreRationale(story)}`;
}

/**
 * A compact, deterministic "why this score" tail (ADR-0034) — e.g.
 * ` · major real-world impact · 3 sources · official source`. The interpretation
 * (labels + thresholds) lives in the shared `scoreExplanation` (ADR-0037); this is
 * just formatting. Empty for Stories scored before the breakdown existed.
 */
function scoreRationale(story: Story): string {
  if (!story.scoreBreakdown) return '';
  const { tags } = scoreExplanation(story.scoreBreakdown);
  return tags.length ? ` · ${tags.join(' · ')}` : '';
}

/** The provenance line for a Story: its canonical source link, if any (ADR-0027). */
function sourceLine(story: Story): string {
  return story.url ? `🔗 ${story.url}` : '';
}

/** The first `n` sentences of an analysis, for the mid `brief` depth. */
function firstSentences(text: string, n: number): string {
  const matches = text.match(/[^.!?]*[.!?](?:\s|$)/g);
  if (!matches) return text.trim();
  return matches.slice(0, n).join('').trim() || text.trim();
}

function renderBrief(selection: BudgetedStory[], minutes: number): string {
  if (selection.length === 0) {
    return `No stories fit a ${minutes}-minute brief.`;
  }
  const noun = selection.length === 1 ? 'story' : 'stories';
  const header = `Horizon brief — ${minutes} min, ${selection.length} ${noun}`;
  return [header, '', selection.map(renderStory).join('\n\n')].join('\n');
}

function renderOutline(topic: Topic, selection: BudgetedStory[]): string {
  if (selection.length === 0) {
    return `No ${topic} stories available.`;
  }
  const header = `${topic} outline`;
  return [header, '', selection.map(renderStory).join('\n\n')].join('\n');
}
