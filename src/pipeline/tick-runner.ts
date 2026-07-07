import { extract, type SourceFailure } from './extract.js';
import { classify } from './classify.js';
import { embed } from './embed.js';
import { cluster } from './cluster.js';
import { resolve, type IdentifiedCluster } from './resolve.js';
import { score } from './score.js';
import { analyze } from './analyze.js';
import { observeSignals } from './observe-signals.js';
import { assembleSignalContext, type SaturationRefs } from '../scoring/signal-context.js';
import { representativeOf } from '../domain/cluster.js';
import { decodeEntities, stripHtml, collapseWhitespace } from '../text/clean.js';
import type { SourceAdapter } from '../sources/source-adapter.js';
import type { SignalSource } from '../sources/signal-source.js';
import type { RawItemRepo } from '../db/raw-item-repo.js';
import type { StoryRepo, StoryUpsert } from '../db/story-repo.js';
import type { SignalObservationRepo } from '../db/signal-observation-repo.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { Embedder } from '../embedding/embedder.js';
import type { Clock } from '../scheduler/clock.js';
import type { SourceId } from '../domain/types.js';
import type { AnalyzedCluster } from './types.js';

const HOUR_MS = 3_600_000;

export interface TickConfig {
  readonly candidateThreshold: number;
  /** Optional entity-aware blocking layer (ADR-0036); absent ⇒ pure cosine. */
  readonly entityBlocking?: { readonly relaxedThreshold: number; readonly minSharedEntities: number };
  readonly recentWindowHours: number;
  readonly recencyHalfLifeHours: number;
  readonly deepAnalysisTopN: number;
  readonly sourceWeights: Partial<Record<SourceId, number>>;
  /** Max absolute numeric-Signal nudge to significance (ADR-0025); 0/absent disables it. */
  readonly maxSignalAdjustment?: number;
  /** Max fractional salience lift for a rising Signal series (ADR-0044); 0/absent ⇒ snapshot only. */
  readonly signalTrendBoost?: number;
  /** Weight of entity-level Pageviews attention on a matching story (ADR-0043); 0/absent ⇒ off. */
  readonly entitySignalWeight?: number;
  /** Prune persisted Signal observations older than this many days (ADR-0042); 0/absent ⇒ keep all. */
  readonly signalHistoryDays?: number;
  /** Resolve across all Topics, not just the Cluster's own (ADR-0038); absent ⇒ same-Topic. */
  readonly crossTopic?: boolean;
  /** Max concurrent LLM confirm calls in cluster/resolve (ADR-0038); absent ⇒ default. */
  readonly confirmConcurrency?: number;
}

export interface TickRunnerDeps {
  readonly sources: readonly SourceAdapter[];
  /** Numeric Signal sources (ADR-0025); optional — absent means no signal nudge. */
  readonly signalSources?: readonly SignalSource[];
  readonly rawItemRepo: RawItemRepo;
  readonly storyRepo: StoryRepo;
  /** Persisted Signal history for trend enrichment (ADR-0044); absent ⇒ snapshot-only. */
  readonly signalObservationRepo?: SignalObservationRepo;
  readonly llm: LLMClient;
  readonly embedder: Embedder;
  readonly clock: Clock;
  readonly config: TickConfig;
}

/** Structured outcome of one tick (ADR-0010) — for logging/observability. */
export interface TickReport {
  readonly extracted: number;
  readonly skipped: SourceId[];
  readonly failed: SourceFailure[];
  readonly storiesUpserted: number;
  /** Numeric Signal observations collected this tick (ADR-0025). */
  readonly signalsObserved: number;
  /** Signal sources skipped (health) or that threw (isolated). */
  readonly signalsSkipped: SourceId[];
  readonly signalsFailed: SourceFailure[];
}

/**
 * The Active Editor (feature #3, ADR-0010). A deep module: callers know only
 * `run()`, behind which the whole staged batch pipeline executes —
 * extract → persist raw → classify → embed → cluster → score → analyze →
 * upsert stories.
 */
export class TickRunner {
  constructor(private readonly deps: TickRunnerDeps) {}

  async run(): Promise<TickReport> {
    const { rawItemRepo, storyRepo, llm, embedder, clock, config } = this.deps;

    const extraction = await extract(this.deps.sources);
    await rawItemRepo.upsert(extraction.items);

    // Numeric Signal context for this tick (ADR-0025): observed fresh, used in-tick.
    // Each source owns its saturation scale; derive the map from the live sources
    // so a new signal source can never be added without declaring one (ADR-0031).
    const signalSources = this.deps.signalSources ?? [];
    const signals = await observeSignals(signalSources);
    const refBySource: SaturationRefs = Object.fromEntries(
      signalSources.map((s) => [s.id, s.saturationReference]),
    );

    // Trend enrichment (ADR-0044): load each series' prior reading BEFORE recording
    // this tick, so a rising series lifts its salience over a flat one.
    const signalRepo = this.deps.signalObservationRepo;
    const priorByKey =
      signalRepo && (config.signalTrendBoost ?? 0) > 0
        ? await signalRepo.priorValues(signals.observations.map((o) => o.key))
        : undefined;

    const signalContext = assembleSignalContext(signals.observations, refBySource, {
      ...(priorByKey ? { priorByKey } : {}),
      ...(config.signalTrendBoost ? { trendBoost: config.signalTrendBoost } : {}),
      ...(config.entitySignalWeight ? { entityWeight: config.entitySignalWeight } : {}),
    });

    // Persist this tick's observations, then prune the history window (ADR-0042/0044).
    if (signalRepo) {
      await signalRepo.record(signals.observations);
      const days = config.signalHistoryDays ?? 0;
      if (days > 0) {
        await signalRepo.pruneOlderThan(clock.now() - days * 24 * HOUR_MS);
      }
    }

    const classified = await classify(extraction.items, llm, config.confirmConcurrency);
    const embedded = await embed(classified, embedder);
    const clusters = await cluster(embedded, llm, {
      candidateThreshold: config.candidateThreshold,
      ...(config.entityBlocking ? { entityBlocking: config.entityBlocking } : {}),
      ...(config.confirmConcurrency ? { confirmConcurrency: config.confirmConcurrency } : {}),
    });
    // Cross-tick identity: merge each Cluster into a matching prior Story (ADR-0017/0038).
    const identified = await resolve(clusters, embedded, { storyRepo, rawItemRepo, llm, clock }, {
      candidateThreshold: config.candidateThreshold,
      recentWindowHours: config.recentWindowHours,
      ...(config.crossTopic ? { crossTopic: config.crossTopic } : {}),
      ...(config.confirmConcurrency ? { confirmConcurrency: config.confirmConcurrency } : {}),
    });

    const scored = await score(identified.map((i) => i.cluster), llm, {
      clock,
      recencyHalfLifeHours: config.recencyHalfLifeHours,
      sourceWeights: config.sourceWeights,
      signalContext,
      maxSignalAdjustment: config.maxSignalAdjustment ?? 0,
      ...(config.confirmConcurrency ? { concurrency: config.confirmConcurrency } : {}),
    });
    const analyzed = await analyze(scored, llm, config.deepAnalysisTopN);

    // The deep tier only analyzes the top-N this tick; every other Story re-upserts
    // with null analysis. Read the current analysis first so a cheap re-run keeps
    // the summary/why a prior tick (or the backfill) already wrote (ADR-0047).
    const prior = await storyRepo.existingAnalysis(identified.map((i) => i.id));

    try {
      // score/analyze/resolve all preserve order, so index i lines up across them.
      for (let i = 0; i < analyzed.length; i += 1) {
        const { id, vector } = identified[i] as IdentifiedCluster;
        await storyRepo.upsert(
          toStoryUpsert(analyzed[i] as AnalyzedCluster, id, prior.get(id)),
        );
        // Skip persisting an empty vector (a missing embedding): a stored `[]`
        // has cosine 0 against everything, so the Story would silently never
        // cross-tick-merge and never surface in semantic search (ADR-0049).
        if (vector.length > 0) await storyRepo.putVector(id, vector);
      }
    } finally {
      // Reassigning members across ticks can leave a prior Story empty; sweep the
      // orphans even if an upsert threw, so a partial tick can't leave the
      // read-model dirty (ADR-0038/0047).
      await storyRepo.pruneOrphans();
    }

    return {
      extracted: extraction.items.length,
      skipped: extraction.skipped,
      failed: extraction.failed,
      storiesUpserted: analyzed.length,
      signalsObserved: signals.observations.length,
      signalsSkipped: signals.skipped,
      signalsFailed: signals.failed,
    };
  }
}

/**
 * Build a StoryUpsert from an analyzed Cluster under its resolved Story id
 * (ADR-0017). `prior` is the Story's current analysis (if it already exists), so
 * a cheap re-upsert never downgrades a good summary/why (ADR-0047):
 *  - whyItMatters: this tick's deep value → else the prior value → else null.
 *  - summary: this tick's deep value → else the prior value → else a
 *    deterministic lead from the source text (the readability floor for a
 *    brand-new, not-yet-analyzed Story, ADR-0006/0024).
 */
function toStoryUpsert(
  analyzed: AnalyzedCluster,
  id: string,
  prior?: { summary: string | null; whyItMatters: string | null },
): StoryUpsert {
  const { cluster, significance, summary, whyItMatters, breakdown } = analyzed;
  const rep = representativeOf(cluster);
  return {
    id,
    title: rep.title,
    scoreBreakdown: breakdown,
    // Always keep a link to a corroborating article: prefer the representative's
    // url, else the first member that carries one (some sources lack urls).
    url: rep.url ?? cluster.items.find((i) => i.url)?.url ?? null,
    topic: cluster.topic,
    significance,
    summary: summary ?? prior?.summary ?? leadSummary(rep.text),
    whyItMatters: whyItMatters ?? prior?.whyItMatters ?? null,
    memberRefs: cluster.items.map((i) => ({
      source: i.source,
      externalId: i.externalId,
    })),
  };
}

const SUMMARY_MAX_CHARS = 280;

/**
 * A deterministic "what happened" from a source snippet: strip markup, collapse
 * whitespace, keep the first couple of sentences, and cap the length. Null when
 * there is no usable text. Pure — no LLM, so every text-bearing Story gets a
 * factual line regardless of the analyze budget.
 */
function leadSummary(text: string | null): string | null {
  if (!text) return null;
  const clean = collapseWhitespace(decodeEntities(stripHtml(text)));
  if (!clean) return null;

  const sentences = clean.match(/[^.!?]*[.!?](?:\s|$)/g);
  const lead = (sentences ? sentences.slice(0, 2).join('').trim() : '') || clean;
  return lead.length > SUMMARY_MAX_CHARS
    ? `${lead.slice(0, SUMMARY_MAX_CHARS).trimEnd()}…`
    : lead;
}

