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
