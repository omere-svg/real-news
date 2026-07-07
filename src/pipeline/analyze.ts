import { representativeOf } from '../domain/cluster.js';
import { looksNonEnglish } from '../text/language.js';
import type { PipelineReasoner } from '../llm/llm-client.js';
import type { AnalyzedCluster, ScoredCluster } from './types.js';

/**
 * Analyze stage (ADR-0006). The expensive deep tier writes both the factual
 * "what happened" summary and the Why-It-Matters justification in one call, but
 * only for the `topN` most significant Clusters. The rest carry nulls — EXCEPT
 * when their representative headline is not English (ADR-0057): the whole product
 * is English-only, so a below-top-N Cluster with a foreign headline escalates to
 * a cheap translation (English displayTitle + short summary) rather than reaching
 * the store/UI as a raw non-English title. Original order is preserved for the
 * downstream upsert.
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
      const lead = representativeOf(scored.cluster);

      if (topIndices.has(i)) {
        const { summary, whyItMatters, displayTitle } = await llm.analyze({
          title: lead.title,
          text: lead.text,
          topic: scored.cluster.topic,
          significance: scored.significance,
        });
        return { ...scored, summary, whyItMatters, displayTitle };
      }

      // Below top-N: no deep pass. Only spend a cheap call when the headline is
      // not English; an English title needs nothing (its raw title is the fallback).
      if (looksNonEnglish(lead.title)) {
        const { displayTitle, summary } = await llm.translateToEnglish({
          title: lead.title,
          text: lead.text,
        });
        return { ...scored, summary, whyItMatters: null, displayTitle };
      }

      return { ...scored, summary: null, whyItMatters: null, displayTitle: null };
    }),
  );
}
