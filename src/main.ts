import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/libsql/migrator';
import {
  loadConfig,
  toPresentationDefaults,
  toQueryParams,
  toTickConfig,
} from './config/load.js';
import { openDb } from './db/client.js';
import { DrizzleRawItemRepo } from './db/raw-item-repo.js';
import { DrizzleStoryRepo } from './db/story-repo.js';
import { HackerNewsSource } from './sources/hacker-news.js';
import { ArxivSource } from './sources/arxiv.js';
import { GdeltSource } from './sources/gdelt.js';
import { KnessetSource } from './sources/knesset.js';
import { SecEdgarSource } from './sources/sec-edgar.js';
import { WikipediaSource } from './sources/wikipedia.js';
import { fetchJson } from './sources/http.js';
import type { SourceAdapter } from './sources/source-adapter.js';
import { Reasoner } from './llm/reasoner.js';
import { OpenAITransport } from './llm/openai-transport.js';
import { ResilientLLMClient } from './llm/resilient-llm-client.js';
import { HashingEmbedder } from './embedding/hashing-embedder.js';
import { OpenAIEmbedder } from './embedding/openai-embedder.js';
import { ResilientEmbedder } from './embedding/resilient-embedder.js';
import type { Embedder } from './embedding/embedder.js';
import { systemClock } from './scheduler/clock.js';
import { TickRunner } from './pipeline/tick-runner.js';
import { createApp } from './server/app.js';
import { HorizonQuery } from './presentation/horizon-query.js';
import type { Config, SourceConfig } from './config/schema.js';

/**
 * Composition root (the only place adapters are wired). Loads config, opens the
 * DB, builds the real adapters behind each seam, runs the tick loop, and serves
 * the read-only viewer. Everything it assembles is unit-tested in isolation.
 */

const CONFIG_PATH = process.env.HORIZON_CONFIG ?? 'config/horizon.yaml';
const DB_URL = process.env.DB_URL ?? 'file:./data/horizon.db';
const PORT = Number(process.env.PORT ?? 3000);

/** Build the concrete SourceAdapter for one enabled source config. */
function buildSource(s: SourceConfig): SourceAdapter | null {
  const base = { fetchJson, maxItems: s.maxItems };
  switch (s.id) {
    case 'hackernews':
      return new HackerNewsSource(base);
    case 'arxiv':
      return new ArxivSource(base);
    case 'gdelt':
      return new GdeltSource(base);
    case 'knesset':
      return new KnessetSource(base);
    case 'secedgar':
      return new SecEdgarSource(base);
    case 'wikipedia':
      return new WikipediaSource({ ...base, clock: systemClock });
    default:
      console.warn(`[horizon] source "${s.id}" has no adapter yet — skipping.`);
      return null;
  }
}

/** Build the Embedder seam from config — neural with a hashing fallback (ADR-0018). */
function buildEmbedder(config: Config): Embedder {
  const { provider, model, dimensions } = config.embedder;
  const hashing = new HashingEmbedder(dimensions);
  if (provider === 'hashing') return hashing;
  return new ResilientEmbedder(
    new OpenAIEmbedder({ model, dimensions }),
    hashing,
  );
}

function buildSources(config: Config): SourceAdapter[] {
  return (config.sources as SourceConfig[])
    .filter((s) => s.enabled)
    .map(buildSource)
    .filter((a): a is SourceAdapter => a !== null);
}

async function main(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);

  if (DB_URL.startsWith('file:')) mkdirSync('./data', { recursive: true });
  const db = openDb(DB_URL, process.env.DB_AUTH_TOKEN);
  await migrate(db, { migrationsFolder: './drizzle' });

  const rawItemRepo = new DrizzleRawItemRepo(db);
  const storyRepo = new DrizzleStoryRepo(db, systemClock);

  const llm = new ResilientLLMClient(
    new Reasoner(
      new OpenAITransport({
        cheapModel: config.reasoner.cheapModel,
        deepModel: config.reasoner.deepModel,
      }),
    ),
  );

  const queryEngine = new HorizonQuery({
    storyRepo,
    llm,
    params: toQueryParams(config),
  });

  const runner = new TickRunner({
    sources: buildSources(config),
    rawItemRepo,
    storyRepo,
    llm,
    embedder: buildEmbedder(config),
    clock: systemClock,
    config: toTickConfig(config),
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

  const app = createApp(storyRepo, queryEngine, toPresentationDefaults(config));
  serve({ fetch: app.fetch, port: PORT });
  console.log(`[horizon] viewer on http://localhost:${PORT} (tick every ${config.tickIntervalMinutes}m)`);
}

main().catch((err) => {
  console.error('[horizon] fatal:', err);
  process.exit(1);
});
