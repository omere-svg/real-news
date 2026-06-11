import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';

/** The Drizzle handle every repository is constructed against (the Store seam, ADR-0002). */
export type Db = LibSQLDatabase<typeof schema>;

/** Open a libsql-backed Drizzle database at `url` (e.g. file path or :memory:). */
export function openDb(url: string): Db {
  return drizzle(createClient({ url }), { schema });
}
