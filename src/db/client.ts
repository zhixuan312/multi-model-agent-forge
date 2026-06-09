import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '@/db/schema';

/**
 * The Drizzle client, backed by postgres-js, configured from `DATABASE_URL`.
 *
 * The connection pool and the Drizzle wrapper are created **lazily** on first
 * access — importing this module has no side effect and does not require
 * `DATABASE_URL`, so pure-logic units (e.g. the secret-store crypto) that
 * transitively import it can run without a database. Behind the `SessionStore` /
 * `SecretStore` interfaces so call sites never import this directly.
 */
function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error('DATABASE_URL is not set — Forge cannot reach Postgres.');
  }
  return url;
}

let _sql: Sql | undefined;
let _db: PostgresJsDatabase<typeof schema> | undefined;

/** The shared postgres-js connection pool (created on first call). */
export function getSql(): Sql {
  if (!_sql) {
    _sql = postgres(databaseUrl());
  }
  return _sql;
}

/** The shared Drizzle client (created on first call). */
export function getDb(): Db {
  if (!_db) {
    _db = drizzle(getSql(), { schema });
  }
  return _db;
}

export type Db = PostgresJsDatabase<typeof schema>;
