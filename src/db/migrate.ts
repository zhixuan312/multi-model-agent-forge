import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Programmatic migrator — `pnpm db:migrate`.
 *
 * Applies the additive SQL migrations under `src/db/migrations/` to the database
 * named by `DATABASE_URL`. Uses a dedicated single-connection client (`max: 1`)
 * per drizzle-kit guidance for migrations, and closes it when done.
 *
 * ## Migrations here are HAND-WRITTEN
 *
 * `meta/` holds one snapshot — `0000_snapshot.json` — for twenty-two migrations. Everything
 * from 0001 on was written by hand, additively (`ALTER TABLE`, never regenerate-and-replace),
 * which is the policy. This path is unaffected: `_journal.json` lists all 22, every `.sql`
 * exists, and `tests/db/migrations-cover-schema.test.ts` asserts the SQL creates every table
 * and mentions every column the Drizzle schema declares.
 *
 * `drizzle-kit generate` is NOT usable in that arrangement, and the `db:generate` script has
 * been removed. It diffs the schema against the latest snapshot, which is the state after
 * migration 0000 — so it sees eleven live tables to drop and five to create, and asks
 * whether each is a rename. Anyone following the ordinary Drizzle workflow would have
 * committed a migration that drops eleven tables holding real data. Restoring the script
 * means rebuilding the snapshots first; the test enforces that pairing.
 */
export async function runMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error('DATABASE_URL is not set — cannot run migrations.');
  }
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  } finally {
    await client.end();
  }
}

// Run when invoked directly (tsx src/db/migrate.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
