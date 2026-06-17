import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { configSchema, type Config } from './schema.js';
import type { Region, SourceId, Topic } from '../domain/types.js';
import type { TickConfig } from '../pipeline/tick-runner.js';
import type { QueryParams } from '../presentation/horizon-query.js';
import type { PresentationDefaults } from '../server/app.js';

/** Validate raw config (already parsed from YAML/JSON) into a frozen Config. */
export function parseConfig(raw: unknown): Config {
  return Object.freeze(configSchema.parse(raw));
}

/** Read, parse, and validate config from a YAML file (ADR-0003). */
export function loadConfig(path: string): Config {
  return parseConfig(parseYaml(readFileSync(path, 'utf8')));
}

/** Derive the per-source editorial weights map the scorer needs (ADR-0008). */
export function sourceWeightsOf(
  config: Config,
): Partial<Record<SourceId, number>> {
  const weights: Partial<Record<SourceId, number>> = {};
  for (const source of config.sources) {
    weights[source.id] = source.weight;
  }
  return weights;
}

/**
 * Flatten the validated Config into the pipeline's TickConfig — the single,
 * tested place this mapping lives (the composition root just wires it).
 */
export function toTickConfig(config: Config): TickConfig {
  return {
    candidateThreshold: config.dedup.candidateThreshold,
    recencyHalfLifeHours: config.scoring.recencyHalfLifeHours,
    maxEditorialAdjustment: config.scoring.maxEditorialAdjustment,
    deepAnalysisTopN: config.reasoner.deepAnalysisTopN,
    sourceWeights: sourceWeightsOf(config),
  };
}

/** Flatten presentation config into the QueryEngine's budget tunables (ADR-0013/0015). */
export function toQueryParams(config: Config): QueryParams {
  const p = config.presentation;
  return {
    textWordsPerMinute: p.textWordsPerMinute,
    audioWordsPerMinute: p.audioWordsPerMinute,
    candidatePool: p.candidatePool,
    wordCost: p.wordCost,
  };
}

/** The default attention budget + preferences the HTTP layer applies (ADR-0015). */
export function toPresentationDefaults(config: Config): PresentationDefaults {
  const p = config.presentation;
  return {
    minutes: p.defaultMinutes,
    ...(p.preferredRegions.length
      ? { regions: p.preferredRegions as Region[] }
      : {}),
    ...(p.preferredTopics.length
      ? { topics: p.preferredTopics as Topic[] }
      : {}),
  };
}
