import type { StoryRepo } from '../db/story-repo.js';
import type { Narrator } from '../llm/llm-client.js';
import type { Story } from '../domain/types.js';
import { cosine } from '../embedding/cosine.js';
import {
  budgetStories,
  type BudgetedStory,
  type BudgetParams,
  type Depth,
} from './budget.js';
import type { BriefRequest, BriefStory, QueryEngine } from './query-engine.js';
import { scoreExplanation } from './score-explanation.js';

/**
 * The Presentation seam implemented (ADR-0011 / ADR-0014). Turns the
 * pre-compiled Story cache, under a time budget (ADR-0013), into user-facing
 * artifacts — never calling external services (Principle 4). The text brief is a
 * pure deterministic render of stored Story fields; only the podcast escalates
 * to the Reasoner's `narrate`, and even that degrades to the brief on failure.
 */

/** Tunables injected from config (ADR-0003) so the engine stays declarative. */
export interface QueryParams {
  /** Reading rate for the text brief. */
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
  /**
   * Same-event diversity guard (ADR-0053): two candidates whose stored
   * embeddings reach this cosine similarity are treated as one event — only the
   * higher-ranked one is shown. Omit to disable.
   */
  readonly dedupSimilarity?: number;
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

  /**
   * The structured twin of `textBrief` (ADR-0064): identical selection + depth,
   * mapped to render-ready cards carrying each Story's inspectable score
   * breakdown. Uses the text reading rate so it matches the `/api/brief` text
   * one-for-one — the web renders these, the bot renders the text.
   */
  async briefStories(request: BriefRequest): Promise<readonly BriefStory[]> {
    const selection = await this.select(
      request,
      this.deps.params.textWordsPerMinute,
    );
    return selection.map(toBriefStory);
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
      // Vector fetch is bounded to the top of the SAME ordering the budget
      // admits by, so the guard covers every story that can actually be shown.
      ...(await this.similarityGuard(
        weighted ? [...candidates].sort((a, b) => rank(b) - rank(a)) : candidates,
      )),
    });
  }

  /**
   * Build the same-event suppressor from the candidates' stored embeddings
   * (ADR-0053). Bounded: only the top slice that could plausibly be admitted
   * (a few × maxStories) has its vectors fetched, so a public, unauthenticated
   * brief request never pulls the whole 200-vector pool from the DB. A story
   * with no vector never suppresses or is suppressed. Off when
   * `dedupSimilarity` is unset.
   */
  private async similarityGuard(
    candidates: readonly Story[],
  ): Promise<Pick<BudgetParams, 'suppressSimilar'>> {
    const cap = this.deps.params.dedupSimilarity;
    if (cap === undefined) return {};
    const slice = candidates.slice(0, this.deps.params.maxStories * 3);
    const vectors = await this.deps.storyRepo.vectorsFor(slice.map((s) => s.id));
    return {
      suppressSimilar: (a: Story, b: Story): boolean => {
        const va = vectors.get(a.id);
        const vb = vectors.get(b.id);
        return Boolean(va && vb && cosine(va, vb) >= cap);
      },
    };
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
  // Prefer the deep tier's English display title when set (Task 20) — the bot
  // brief otherwise relays a raw non-English/mangled source headline verbatim.
  const lines = [`📰 ${story.displayTitle || story.title}`];
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

/**
 * Map a budgeted Story to the web card shape (ADR-0064): depth-trimmed
 * summary/why EXACTLY as `renderStory` renders them (so the web card and the
 * text brief never disagree), plus the interpreted score breakdown for the
 * expandable "Why this score?" widget.
 */
function toBriefStory({ story, depth }: BudgetedStory): BriefStory {
  const summaryRaw = story.summary?.trim() || null;
  const summary =
    depth === 'headline'
      ? null
      : summaryRaw
        ? depth === 'brief'
          ? firstSentences(summaryRaw, 2)
          : summaryRaw
        : null;
  const whyItMatters = depth === 'full' ? (story.whyItMatters?.trim() || null) : null;
  const exp = story.scoreBreakdown ? scoreExplanation(story.scoreBreakdown) : null;
  // The web surface intentionally hides the "public attention" axis (its driver
  // bar and its "high public interest" tag): attention is a bounded popularity
  // nudge, not editorial newsworthiness, and showing it invites the wrong read.
  // The score itself still uses it (see compute-base-score) — this is display-only.
  const drivers = (exp?.drivers ?? []).filter((d) => d.key !== 'attention');
  const tags = (exp?.tags ?? []).filter((t) => t !== 'high public interest');
  return {
    title: story.displayTitle || story.title,
    topic: story.topic,
    significance: story.significance,
    url: story.url,
    summary,
    whyItMatters,
    depth,
    tags,
    drivers,
    recencyFactor: exp?.recencyFactor ?? 0,
    corroboration: exp?.corroboration ?? 0,
    signalNudge: exp?.signalNudge ?? 0,
  };
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
