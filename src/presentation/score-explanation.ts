import type { ScoreBreakdown, ScoreComponentKey } from '../domain/types.js';

/**
 * The single interpreter of a Story's ScoreBreakdown (ADR-0037). Both presentation
 * surfaces — the deterministic text rationale (`horizon-query`) and the web
 * viewer's "Why this score?" widget (`server/ui`) — read the breakdown's *meaning*
 * from here, so the human labels and the rationale thresholds live in ONE place
 * with one test surface, instead of being re-decoded per renderer.
 */

/** Human label for each scoring axis (ADR-0034). */
export const COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  impact: 'Real-world impact',
  corroboration: 'Corroboration',
  authority: 'Source authority',
  attention: 'Public attention',
};

/** Thresholds that turn breakdown values into the compact rationale tags. */
const TAG_THRESHOLDS = {
  majorImpact: 0.66,
  notableImpact: 0.4,
  officialSource: 0.65, // authority axis
  highInterest: 0.5, // attention axis
  fresh: 0.9, // recency factor
  minSources: 2, // corroboration count
} as const;

/** Strength of one axis, normalized to [0, 1], with its human label. */
export interface ScoreDriver {
  readonly key: ScoreComponentKey;
  readonly label: string;
  readonly value: number;
}

/** The interpreted, render-ready view of a ScoreBreakdown. */
export interface ScoreExplanation {
  /** Axes sorted strongest-first, labeled — for the web "Why this score?" table. */
  readonly drivers: readonly ScoreDriver[];
  /** Compact human tags naming the true drivers — for the brief/bot rationale tail. */
  readonly tags: readonly string[];
  /** Recency factor in [0, 1] that was applied. */
  readonly recencyFactor: number;
  /** Distinct corroborating sources. */
  readonly corroboration: number;
  /** Bounded numeric-Signal nudge (signed). */
  readonly signalNudge: number;
}

/** Interpret a breakdown into labeled drivers + compact tags. Pure. */
export function scoreExplanation(breakdown: ScoreBreakdown): ScoreExplanation {
  const value = (key: ScoreComponentKey): number =>
    breakdown.components.find((c) => c.key === key)?.value ?? 0;

  const drivers: ScoreDriver[] = [...breakdown.components]
    .map((c) => ({ key: c.key, label: COMPONENT_LABELS[c.key] ?? c.key, value: c.value }))
    .sort((a, b) => b.value - a.value);

  const tags: string[] = [];
  if (breakdown.impact >= TAG_THRESHOLDS.majorImpact) tags.push('major real-world impact');
  else if (breakdown.impact >= TAG_THRESHOLDS.notableImpact) tags.push('notable impact');
  if (breakdown.signals.corroboration >= TAG_THRESHOLDS.minSources) {
    tags.push(`${breakdown.signals.corroboration} sources`);
  }
  if (value('authority') >= TAG_THRESHOLDS.officialSource) tags.push('official source');
  if (value('attention') >= TAG_THRESHOLDS.highInterest) tags.push('high public interest');
  if (breakdown.recencyFactor >= TAG_THRESHOLDS.fresh) tags.push('fresh');

  return {
    drivers,
    tags,
    recencyFactor: breakdown.recencyFactor,
    corroboration: breakdown.signals.corroboration,
    signalNudge: breakdown.signalNudge,
  };
}
