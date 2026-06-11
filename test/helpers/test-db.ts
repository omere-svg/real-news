import { migrate } from 'drizzle-orm/libsql/migrator';
import { openDb, type Db } from '../../src/db/client.js';

/**
 * A fresh in-memory database with the full schema applied via the real
 * migrations (one source of truth — ADR-0002/0005). Each call is isolated.
 */
export async function createTestDb(): Promise<Db> {
  const db = openDb(':memory:');
  await migrate(db, { migrationsFolder: './drizzle' });
  return db;
}
