import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { configSchema, type Config } from './schema.js';
import type { SourceId } from '../domain/types.js';

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
