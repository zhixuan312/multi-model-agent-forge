import { uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { team } from '@/db/schema/team';
import { REPO_STATUS } from '@/db/enums';

export const repo = forge.table(
  'workspace_repo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => team.id),
    name: text('name').notNull(),
    pathOnDisk: text('path_on_disk').notNull(),
    defaultBranch: text('default_branch').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    headSha: text('head_sha'),
    status: text('status', { enum: REPO_STATUS }).notNull().default('cloned'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('workspace_repo_team_name_uniq').on(t.teamId, t.name), index('repo_team_idx').on(t.teamId), index('repo_tags_gin').using('gin', t.tags)],
);
