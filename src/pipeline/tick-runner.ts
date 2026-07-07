import { extract, type SourceFailure } from './extract.js';
import { classify } from './classify.js';
import { embed } from './embed.js';
import { cluster } from './cluster.js';
import { resolve } from './resolve.js';
import { score } from './score.js';
import { analyze } from './analyze.js';
import { observeSignals } from './observe-signals.js';
import { assembleSignalContext, type SaturationRefs } from '../scoring/signal-context.js';
import { representativeOf } from '../domain/cluster.js';
import { decodeEntities, stripHtml, collapseWhitespace } from '../text/clean.js';
import type { SourceAdapter } from '../sources/source-adapter.js';
import type { SignalSource } from '../sources/signal-source.js';
import type { RawItemRepo } from '../db/raw-item-repo.js';
import type { StoryRepo, StoryUpsert, StoryAnalysisFields } from '../db/story-repo.js';
import type { SignalObservationRepo } from '../db/signal-observation-repo.js';
import type { PipelineReasoner } from '../llm/llm-client.js';
import type { Embedder } from '../embedding/embedder.js';
import type { Clock } from '../scheduler/clock.js';
import type { SourceId } from '../domain/types.js';
import { nullLogger, type Logger } from '../log/logger.js';
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
  readonly llm: PipelineReasoner;
  readonly embedder: Embedder;
  readonly clock: Clock;
  readonly config: TickConfig;
  /** Structured-log sink (src/log/logger.ts); absent ⇒ nullLogger (tests). */
  readonly log?: Logger;
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

  async run(
    opts: {
      skipSources?: ReadonlySet<SourceId>;
      /** Per-run override of the deep-analysis budget — the reflection→action
       * loop's screened policy (ADR-0053); defaults to config. */
      deepAnalysisTopN?: number;
      /** Per-run confirm-concurrency override from the reflection policy (ADR-0061). */
      confirmConcurrency?: number;
      /** Per-run merge-sensitivity override from the reflection policy (ADR-0061). */
      candidateThreshold?: number;
    } = {},
  ): Promise<TickReport> {
    const { rawItemRepo, storyRepo, llm, embedder, clock, config } = this.deps;
    const log = this.deps.log ?? nullLogger;
    // The reflection→action loop may override these two knobs per tick (ADR-0061);
    // absent ⇒ the configured default. Everything downstream reads the effective
    // value so a screened policy actually changes this tick's behavior.
    const confirmConcurrency = opts.confirmConcurrency ?? config.confirmConcurrency;
    const candidateThreshold = opts.candidateThreshold ?? config.candidateThreshold;

    // Adaptive backoff (ADR-0052): the loop may ask us to skip Sources that have
    // failed repeatedly, so we don't spend a rate-limited fetch on a known-bad one.
    const skip = opts.skipSources;
    const sources = skip && skip.size ? this.deps.sources.filter((s) => !skip.has(s.id)) : this.deps.sources;
    const extraction = await extract(sources);
    await rawItemRepo.upsert(extraction.items);

    // Numeric Signal context for this tick (ADR-0025): observed fresh, used in-tick.
    // Each source owns its saturation scale; derive the map from the live sources
    // so a new signal source can never be added without declaring one (ADR-0031).
    // Signal sources honor the backoff skip set too (ADR-0054).
    const allSignalSources = this.deps.signalSources ?? [];
    const signalSources =
      skip && skip.size ? allSignalSources.filter((s) => !skip.has(s.id)) : allSignalSources;
    const signals = await observeSignals(signalSources);
    // Defense-in-depth (mirrors raw-item-repo's publishedAt guard, ADR-0051): a
    // Signal source's arithmetic (division, subtraction) can produce NaN/Infinity
    // — e.g. a JSON numeric literal beyond ±1.8e308 silently overflows to Infinity
    // on parse, and `z.number()` accepts it. `value` is a raw numeric DB bind
    // (signal_observations), not JSON; a non-finite bind is rejected by the store
    // with an unrecoverable error. Unlike a throwing Source, nothing isolates
    // that per-observation — it would crash the WHOLE tick (ok:false,
    // extracted:0 in the report) even though extraction fully succeeded. Drop
    // the bad reading instead of letting it anywhere near persistence.
    const observations = signals.observations.filter((o) => Number.isFinite(o.value));
    const refBySource: SaturationRefs = Object.fromEntries(
      signalSources.map((s) => [s.id, s.saturationReference]),
    );

    // Trend enrichment (ADR-0044): load each series' prior reading BEFORE recording
    // this tick, so a rising series lifts its salience over a flat one.
    const signalRepo = this.deps.signalObservationRepo;
    const priorByKey =
      signalRepo && (config.signalTrendBoost ?? 0) > 0
        ? await signalRepo.priorValues(observations.map((o) => o.key))
        : undefined;

    const signalContext = assembleSignalContext(observations, refBySource, {
      ...(priorByKey ? { priorByKey } : {}),
      ...(config.signalTrendBoost ? { trendBoost: config.signalTrendBoost } : {}),
      ...(config.entitySignalWeight ? { entityWeight: config.entitySignalWeight } : {}),
    });

    // Persist this tick's observations, then prune the history window (ADR-0042/0044).
    if (signalRepo) {
      await signalRepo.record(observations);
      const days = config.signalHistoryDays ?? 0;
      if (days > 0) {
        await signalRepo.pruneOlderThan(clock.now() - days * 24 * HOUR_MS);
      }
    }

    const classified = await classify(extraction.items, llm, confirmConcurrency);
    // `degraded` ⇒ the embedder fell back to a non-semantic vector this tick
    // (ADR-0065). We still cluster/resolve with these (internally consistent),
    // but must not persist them, or hash vectors poison the neural index.
    const { items: embedded, degraded: embedDegraded } = await embed(classified, embedder);
    const clusters = await cluster(embedded, llm, {
      candidateThreshold,
      ...(config.entityBlocking ? { entityBlocking: config.entityBlocking } : {}),
      ...(confirmConcurrency ? { confirmConcurrency } : {}),
      log,
    });
    // Cross-tick identity: merge each Cluster into a matching prior Story (ADR-0017/0038).
    // The entity-relaxed band mirrors cluster's strong band and is governed by the
    // SAME config switch (dedup.entityBlocking.enabled) — one kill-switch, both layers.
    const eb = config.entityBlocking;
    const identified = await resolve(clusters, embedded, { storyRepo, rawItemRepo, llm, clock, log }, {
      candidateThreshold,
      recentWindowHours: config.recentWindowHours,
      ...(config.crossTopic ? { crossTopic: config.crossTopic } : {}),
      ...(confirmConcurrency ? { confirmConcurrency } : {}),
      ...(eb
        ? {
            relaxedThreshold: Math.max(0, eb.relaxedThreshold - 0.06),
            relaxedMinSharedEntities: eb.minSharedEntities + 1,
          }
        : {}),
    });

    const scored = await score(identified, llm, {
      clock,
      recencyHalfLifeHours: config.recencyHalfLifeHours,
      sourceWeights: config.sourceWeights,
      signalContext,
      maxSignalAdjustment: config.maxSignalAdjustment ?? 0,
      ...(confirmConcurrency ? { concurrency: confirmConcurrency } : {}),
    });
    const analyzed = await analyze(scored, llm, opts.deepAnalysisTopN ?? config.deepAnalysisTopN);

    // The deep tier only analyzes the top-N this tick; every other Story re-upserts
    // with null analysis. Read the current analysis first so a cheap re-run keeps
    // the summary/why a prior tick (or the backfill) already wrote (ADR-0047).
    const prior = await storyRepo.existingAnalysis(analyzed.map((a) => a.id));

    try {
      // Each analyzed cluster carries its own resolved id + vector (ADR-0063), so
      // the upsert joins by value — no positional re-zip of separate arrays that a
      // future stage reorder could silently misalign.
      for (const a of analyzed) {
        await storyRepo.upsert(toStoryUpsert(a, a.id, prior.get(a.id)));
        // Skip persisting an empty vector (a missing embedding): a stored `[]`
        // has cosine 0 against everything, so the Story would silently never
        // cross-tick-merge and never surface in semantic search (ADR-0049).
        // Skip a degraded (fallback) vector too (ADR-0065): a hash vector in the
        // neural index is worse than none — it mis-matches against every real
        // embedding. The Story keeps whatever good vector a prior tick wrote.
        if (!embedDegraded && a.vector.length > 0) await storyRepo.putVector(a.id, a.vector);
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
      signalsObserved: observations.length,
      signalsSkipped: signals.skipped,
      signalsFailed: signals.failed,
    };
  }
}

/**
 * Build a StoryUpsert from an analyzed Cluster under its resolved Story id
 * (ADR-0017). `prior` is the Story's current analysis (if it already exists), so
 * a cheap re-upsert never downgrades a good summary/why/displayTitle (ADR-0047):
 *  - whyItMatters: this tick's deep value → else the prior value → else null.
 *  - displayTitle: this tick's deep value → else the prior value → else null.
 *  - summary: this tick's deep value → else the prior value → else a
 *    deterministic lead from the source text (the readability floor for a
 *    brand-new, not-yet-analyzed Story, ADR-0006/0024).
 */
function toStoryUpsert(
  analyzed: AnalyzedCluster,
  id: string,
  prior?: StoryAnalysisFields,
): StoryUpsert {
  const { cluster, significance, summary, whyItMatters, displayTitle, breakdown } = analyzed;
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
    displayTitle: displayTitle ?? prior?.displayTitle ?? null,
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

