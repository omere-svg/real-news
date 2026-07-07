/**
 * THROWAWAY (ops): snapshot the live DB into a standalone local backup file the
 * software never touches — run BEFORE a production wipe so the accumulated data
 * stays inspectable. Reads DB_URL/DB_AUTH_TOKEN from .env for the source; writes
 * ./data/backup-<utc-date>.db (schema via the real migrations, then row copies).
 *
 * Usage: node --env-file=.env --import tsx scripts/_backup-db.ts
 */
import { mkdirSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const TABLES = [
  'raw_items',
  'stories',
  'story_vectors',
  'membership',
  'chat_preferences',
  'tick_reports',
  'signal_observations',
  'tick_reflections',
  'usage',
  'web_sessions',
  'link_codes',
  'agent_policy',
  'chat_sessions',
  'chat_traces',
  // tick_lock deliberately skipped: process-local lease, meaningless in a backup.
] as const;

async function main(): Promise<void> {
  const url = process.env.DB_URL;
  if (!url) throw new Error('DB_URL missing — run with --env-file=.env');
  const source = createClient({
    url,
    ...(process.env.DB_AUTH_TOKEN ? { authToken: process.env.DB_AUTH_TOKEN } : {}),
  });

  mkdirSync('./data', { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const destPath = `./data/backup-${day}.db`;
  const dest = createClient({ url: `file:${destPath}` });
  await migrate(drizzle(dest), { migrationsFolder: './drizzle' });

  let total = 0;
  for (const table of TABLES) {
    // A source predating a migration simply lacks the newest tables — skip them.
    const rows = await source.execute(`SELECT * FROM ${table}`).catch((err: unknown) => {
      if (String(err).includes('no such table')) return null;
      throw err;
    });
    if (!rows) {
      console.log(`  ${table}: (not present in source — skipped)`);
      continue;
    }
    if (rows.rows.length === 0) {
      console.log(`  ${table}: 0 rows`);
      continue;
    }
    const cols = rows.columns;
    const placeholders = `(${cols.map(() => '?').join(',')})`;
    // Batch inserts in chunks to stay under statement limits.
    const CHUNK = 200;
    for (let i = 0; i < rows.rows.length; i += CHUNK) {
      const chunk = rows.rows.slice(i, i + CHUNK);
      await dest.batch(
        chunk.map((r) => ({
          sql: `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES ${placeholders}`,
          args: cols.map((c) => r[c] ?? null),
        })),
        'write',
      );
    }
    total += rows.rows.length;
    console.log(`  ${table}: ${rows.rows.length} rows`);
  }
  console.log(`\n✅ backup complete → ${destPath} (${total} rows across ${TABLES.length} tables)`);
}

main().catch((err) => {
  console.error('backup failed:', err);
  process.exit(1);
});
