import type { LLMClient } from '../llm/llm-client.js';
import type { AnalyzedCluster, ScoredCluster } from './types.js';

/**
 * Analyze stage (ADR-0006). The expensive Opus tier writes the Why-It-Matters
 * justification, but only for the `topN` most significant Clusters — the rest
 * carry a null justification. Original order is preserved for downstream upsert.
 */
export async function analyze(
  clusters: readonly ScoredCluster[],
  llm: LLMClient,
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
      if (!topIndices.has(i)) return { ...scored, whyItMatters: null };

      const lead = scored.cluster.items[0];
      const whyItMatters = await llm.analyze({
        title: lead?.title ?? '',
        text: lead?.text ?? null,
        region: scored.cluster.region,
        topic: scored.cluster.topic,
        significance: scored.significance,
      });
      return { ...scored, whyItMatters };
    }),
  );
}
