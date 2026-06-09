import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * All Forge tables live in the dedicated `forge` Postgres schema (the target DB
 * may host other tenants in `public`). Every domain file defines its tables via
 * `forge.table(...)`, so every query is schema-qualified — no search_path reliance.
 */
export const forge = pgSchema('forge');
