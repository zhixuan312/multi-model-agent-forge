/**
 * Schema barrel — one file per domain, re-exported here (schema.md Conventions).
 * Drizzle Kit reads this module to generate migrations.
 */
export * from '@/db/schema/identity';
export * from '@/db/schema/secrets';
export * from '@/db/schema/config';
export * from '@/db/schema/workspace';
export * from '@/db/schema/projects';
export * from '@/db/schema/audit';
