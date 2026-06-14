import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { loadConfig, sourceWeightsOf } from './config/load.js';
import { openDb } from './db/client.js';
import { DrizzleRawItemRepo } from './db/raw-item-repo.js';
import { DrizzleStoryRepo } from './db/story-repo.js';
import { HackerNewsSource } from './sources/hacker-news.js';
import { fetchJson } from './sources/http.js';
import type { SourceAdapter } from './sources/source-adapter.js';
import { AnthropicClient } from './llm/anthropic-client.js';
import { ResilientLLMClient } from './llm/resilient-llm-client.js';
import { HashingEmbedder } from './embedding/hashing-embedder.js';
import { systemClock } from './scheduler/clock.js';
import { TickRunner } from './pipeline/tick-runner.js';
import { createApp } from './server/app.js';
import type { Config, SourceConfig } from './config/schema.js';

/**
 * Composition root (the only place adapters are wired). Loads config, opens the
 * DB, builds the real adapters behind each seam, runs the tick loop, and serves
 * the read-only viewer. Everything it assembles is unit-tested in isolation.
 */

const CONFIG_PATH = process.env.HORIZON_CONFIG ?? 'config/horizon.yaml';
const DB_URL = process.env.DB_URL ?? 'file:./data/horizon.db';
const PORT = Number(process.env.PORT ?? 3000);

/** Build the concrete SourceAdapters for the enabled, implemented sources. */
function buildSources(config: Config): SourceAdapter[] {
  const sources: SourceAdapter[] = [];
  for (const s of config.sources as SourceConfig[]) {
    if (!s.enabled) continue;
    if (s.id === 'hackernews') {
      sources.push(new HackerNewsSource({ fetchJson, maxItems: s.maxItems }));
    } else {
      console.warn(`[horizon] source "${s.id}" has no adapter yet — skipping.`);
    }
  }
  return sources;
}

async function main(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);

  if (DB_URL.startsWith('file:')) mkdirSync('./data', { recursive: true });
  const db = openDb(DB_URL, process.env.DB_AUTH_TOKEN);
  await migrate(db, { migrationsFolder: './drizzle' });

  const rawItemRepo = new DrizzleRawItemRepo(db);
  const storyRepo = new DrizzleStoryRepo(db, systemClock);

  const llm = new ResilientLLMClient(
    new AnthropicClient({
      cheapModel: config.reasoner.cheapModel,
      deepModel: config.reasoner.deepModel,
    }),
  );

  const runner = new TickRunner({
    sources: buildSources(config),
    rawItemRepo,
    storyRepo,
    llm,
    embedder: new HashingEmbedder(),
    clock: systemClock,
    config: {
      candidateThreshold: config.dedup.candidateThreshold,
      recencyHalfLifeHours: config.scoring.recencyHalfLifeHours,
      maxEditorialAdjustment: config.scoring.maxEditorialAdjustment,
      deepAnalysisTopN: config.reasoner.deepAnalysisTopN,
      sourceWeights: sourceWeightsOf(config),
    },
  });

  const runTick = async (): Promise<void> => {
    try {
      const report = await runner.run();
      console.log(
        `[tick] extracted=${report.extracted} stories=${report.storiesUpserted} ` +
          `skipped=[${report.skipped}] failed=[${report.failed.map((f) => f.source)}]`,
      );
    } catch (err) {
      console.error('[tick] failed:', err); // never let a bad tick kill the loop
    }
  };

  // First tick on boot, then every X minutes (ADR-0001).
  void runTick();
  setInterval(() => void runTick(), config.tickIntervalMinutes * 60_000);

  serve({ fetch: createApp(storyRepo).fetch, port: PORT });
  console.log(`[horizon] viewer on http://localhost:${PORT} (tick every ${config.tickIntervalMinutes}m)`);
}

main().catch((err) => {
  console.error('[horizon] fatal:', err);
  process.exit(1);
});
