import { uuid, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import type { PinnedFinding } from '@/journal/recall-content';

/**
 * `journal_pin` — a member's pinned recall answer (the journal domain's first DB
 * table; node/log content stays on disk at `<workspaceRoot>/.mma/journal`).
 *
 * A pin is a refreshable CACHE, not a frozen truth: the question + the synthesized
 * answer + cited node ids at last refresh, plus `journal_log_count` — the number of
 * `log.md` entries when the answer was computed. Staleness is "any journal write
 * since": a pin is stale ⟺ its `journal_log_count` is below the journal's current
 * log-entry count. A count (not a timestamp) is used because `log.md` timestamps
 * may carry mixed UTC offsets, so integer comparison is the robust signal.
 */
export const journalPin = forge.table(
  'journal_pin',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answerMd: text('answer_md').notNull(), // cached synthesis at last refresh
    // Per-learning breakdown at last refresh — so a pin renders at full live fidelity.
    findings: jsonb('findings').$type<PinnedFinding[]>().notNull().default(sql`'[]'::jsonb`),
    citationIds: text('citation_ids').array().notNull().default(sql`'{}'`),
    journalLogCount: integer('journal_log_count').notNull().default(0), // # log.md entries at last refresh
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('journal_pin_member_idx').on(t.memberId, t.createdAt.desc())],
);
