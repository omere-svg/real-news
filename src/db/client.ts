import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';

/** The Drizzle handle every repository is constructed against (the Store seam, ADR-0002). */
export type Db = LibSQLDatabase<typeof schema>;

/**
 * Open a libsql-backed Drizzle database. `url` is `:memory:`, a `file:` path,
 * or a remote Turso `libsql://` URL (then pass `authToken`).
 */
export function openDb(url: string, authToken?: string): Db {
  return drizzle(createClient(authToken ? { url, authToken } : { url }), {
    schema,
  });
}
