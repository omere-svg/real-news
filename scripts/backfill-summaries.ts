/**
 * One-shot backfill: (re)write each Story's factual `summary` + concise
 * `whyItMatters` via the deep tier. The app also self-heals missing summaries on
 * boot (config `reasoner.backfillOnBoot`); use this script to force a full redo
 * after a prompt change, or to fill the cache without a restart.
 *
 *   npm run backfill:summaries           # only Stories missing a summary
 *   npm run backfill:summaries -- --all  # redo every Story (e.g. after a prompt change)
 *
 * Reads the same config/env as the app; needs the LLM API key. Idempotent: it
 * upserts in place, preserving id, url, membership and first-seen time.
 */
import { migrate } from 'drizzle-orm/libsql/migrator';
import { loadConfig } from '../src/config/load.js';
import { openDb } from '../src/db/client.js';
import { DrizzleRawItemRepo } from '../src/db/raw-item-repo.js';
import { DrizzleStoryRepo } from '../src/db/story-repo.js';
import { Reasoner } from '../src/llm/reasoner.js';
import { OpenAITransport } from '../src/llm/openai-transport.js';
import { ResilientLLMClient } from '../src/llm/resilient-llm-client.js';
import { backfillSummaries } from '../src/pipeline/backfill-summaries.js';
import { systemClock } from '../src/scheduler/clock.js';

const CONFIG_PATH = process.env.HORIZON_CONFIG ?? 'config/horizon.yaml';
const DB_URL = process.env.DB_URL ?? 'file:./data/horizon.db';
const REDO_ALL = process.argv.includes('--all');

async function main(): Promise<void> {
  const config = loadConfig(CONFIG_PATH);
  const db = openDb(DB_URL, process.env.DB_AUTH_TOKEN);
  await migrate(db, { migrationsFolder: './drizzle' });

  const deps = {
    storyRepo: new DrizzleStoryRepo(db, systemClock),
    rawItemRepo: new DrizzleRawItemRepo(db),
    llm: new ResilientLLMClient(
      new Reasoner(
        new OpenAITransport({
          cheapModel: config.reasoner.cheapModel,
          deepModel: config.reasoner.deepModel,
        }),
      ),
    ),
  };

  const { processed, total } = await backfillSummaries(deps, {
    all: REDO_ALL,
    onProgress: (done, count, story) =>
      console.log(`[backfill] (${done}/${count}) ${story.id} — ${story.title}`),
  });
  console.log(
    `[backfill] done: ${processed}/${total} stories updated` +
      `${REDO_ALL ? ' (--all)' : ' (missing summary)'}.`,
  );
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
