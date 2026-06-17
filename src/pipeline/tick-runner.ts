import { extract, type SourceFailure } from './extract.js';
import { classify } from './classify.js';
import { embed } from './embed.js';
import { cluster } from './cluster.js';
import { resolve, type IdentifiedCluster } from './resolve.js';
import { score } from './score.js';
import { analyze } from './analyze.js';
import { representativeOf } from '../domain/cluster.js';
import type { SourceAdapter } from '../sources/source-adapter.js';
import type { RawItemRepo } from '../db/raw-item-repo.js';
import type { StoryRepo, StoryUpsert } from '../db/story-repo.js';
import type { LLMClient } from '../llm/llm-client.js';
import type { Embedder } from '../embedding/embedder.js';
import type { Clock } from '../scheduler/clock.js';
import type { SourceId } from '../domain/types.js';
import type { AnalyzedCluster } from './types.js';

export interface TickConfig {
  readonly candidateThreshold: number;
  readonly recentWindowHours: number;
  readonly recencyHalfLifeHours: number;
  readonly maxEditorialAdjustment: number;
  readonly deepAnalysisTopN: number;
  readonly sourceWeights: Partial<Record<SourceId, number>>;
}

export interface TickRunnerDeps {
  readonly sources: readonly SourceAdapter[];
  readonly rawItemRepo: RawItemRepo;
  readonly storyRepo: StoryRepo;
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

    const classified = await classify(extraction.items, llm);
    const embedded = await embed(classified, embedder);
    const clusters = await cluster(embedded, llm, {
      candidateThreshold: config.candidateThreshold,
    });
    // Cross-tick identity: merge each Cluster into a matching prior Story (ADR-0017).
    const identified = await resolve(clusters, embedded, { storyRepo, rawItemRepo, llm, clock }, {
      candidateThreshold: config.candidateThreshold,
      recentWindowHours: config.recentWindowHours,
    });

    const scored = await score(identified.map((i) => i.cluster), llm, {
      clock,
      recencyHalfLifeHours: config.recencyHalfLifeHours,
      maxEditorialAdjustment: config.maxEditorialAdjustment,
      sourceWeights: config.sourceWeights,
    });
    const analyzed = await analyze(scored, llm, config.deepAnalysisTopN);

    // score/analyze/resolve all preserve order, so index i lines up across them.
    for (let i = 0; i < analyzed.length; i += 1) {
      const { id, vector } = identified[i] as IdentifiedCluster;
      await storyRepo.upsert(toStoryUpsert(analyzed[i] as AnalyzedCluster, id));
      await storyRepo.putVector(id, vector);
    }

    return {
      extracted: extraction.items.length,
      skipped: extraction.skipped,
      failed: extraction.failed,
      storiesUpserted: analyzed.length,
    };
  }
}

/** Build a StoryUpsert from an analyzed Cluster under its resolved Story id (ADR-0017). */
function toStoryUpsert(analyzed: AnalyzedCluster, id: string): StoryUpsert {
  const { cluster, significance, whyItMatters } = analyzed;
  const rep = representativeOf(cluster);
  return {
    id,
    title: rep.title,
    url: rep.url,
    region: cluster.region,
    topic: cluster.topic,
    significance,
    whyItMatters,
    memberRefs: cluster.items.map((i) => ({
      source: i.source,
      externalId: i.externalId,
    })),
  };
}
