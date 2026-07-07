import { representativeOf } from '../domain/cluster.js';
import type { PipelineReasoner } from '../llm/llm-client.js';
import type { AnalyzedCluster, ScoredCluster } from './types.js';

/**
 * Analyze stage (ADR-0006). The expensive Opus tier writes both the factual
 * "what happened" summary and the Why-It-Matters justification in one call, but
 * only for the `topN` most significant Clusters — the rest carry nulls. Original
 * order is preserved for downstream upsert.
 */
export async function analyze(
  clusters: readonly ScoredCluster[],
  llm: PipelineReasoner,
  topN: number,
): Promise<AnalyzedCluster[]> {
  const topIndices = new Set(
    clusters
      .map((c, i) => ({ i, significance: c.significance }))
      .sort((a, b) => b.significance - a.significance)
      .slice(0, Math.max(0, topN))
      .map((x) => x.i),
  );

  return Promise.all(
    clusters.map(async (scored, i) => {
      if (!topIndices.has(i)) {
        return { ...scored, summary: null, whyItMatters: null, displayTitle: null };
      }

      const lead = representativeOf(scored.cluster);
      const { summary, whyItMatters, displayTitle } = await llm.analyze({
        title: lead.title,
        text: lead.text,
        topic: scored.cluster.topic,
        significance: scored.significance,
      });
      return { ...scored, summary, whyItMatters, displayTitle };
    }),
  );
}
