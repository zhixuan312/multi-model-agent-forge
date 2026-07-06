/**
 * Schema barrel — one file per domain, re-exported here.
 * Drizzle Kit reads this module to generate migrations.
 */
export * from '@/db/schema/identity';
export * from '@/db/schema/workspace';
export * from '@/db/schema/projects';
export * from '@/db/schema/spec';
export * from '@/db/schema/build';
export * from '@/db/schema/ops';
export * from '@/db/schema/loop';
export * from '@/db/schema/journal';
export * from '@/db/schema/team';
