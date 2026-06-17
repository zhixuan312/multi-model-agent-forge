import { uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { REPO_STATUS } from '@/db/enums';

/**
 * `repo` — a team repository on disk (schema.md §2). The Workspace UI + the
 * clone/pull git service are Part B. Repos are classified by `tags` only — a
 * free-form, GIN-indexed text[] that doubles as the filter axis. `status`
 * tracks the clone/pull lifecycle (cloned | pulling | error).
 */
export const repo = forge.table(
  'repo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    pathOnDisk: text('path_on_disk').notNull(), // under /workspace
    defaultBranch: text('default_branch').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    headSha: text('head_sha'), // last pulled HEAD
    status: text('status', { enum: REPO_STATUS }).notNull().default('cloned'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('repo_tags_gin').using('gin', t.tags), // schema.md §2: GIN on tags
  ],
);
