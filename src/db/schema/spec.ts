import { uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { stage } from '@/db/schema/projects';
import {
  COMPONENT_KIND,
  COMPONENT_STATUS,
  QA_SENDER,
} from '@/db/enums';

/**
 * Spec-stage authoring tables. The component is the unit of discussion,
 * drafting, and approval. Sections are internal structure for organizing
 * draft content only.
 */

/**
 * `project_component` — a top-level part of the spec (e.g. Context, Problem,
 * Technical Design). Carries the dual gate: `ai_satisfied` (model-set) +
 * `human_satisfied` (human-set) → `approved` only when BOTH (or `forced`).
 */
export const component = forge.table(
  'project_component',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => stage.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: COMPONENT_KIND }).notNull(),
    primaryRoles: text('primary_roles').array().notNull(),
    status: text('status', { enum: COMPONENT_STATUS }).notNull().default('gathering'),
    aiSatisfied: boolean('ai_satisfied').notNull().default(false),
    humanSatisfied: boolean('human_satisfied').notNull().default(false),
    forced: boolean('forced').notNull().default(false),
    stale: boolean('stale').notNull().default(false),
    mmaSessionId: text('mma_session_id'),
    orderIndex: integer('order_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('component_stage_idx').on(t.stageId, t.orderIndex)],
);

/**
 * `project_component_section` — the sub-sections within a component.
 * Content only: key, label, draft_md, order. No status or satisfaction
 * flags — those live on the component.
 */
export const componentSection = forge.table(
  'project_component_section',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    componentId: uuid('component_id')
      .notNull()
      .references(() => component.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    draftMd: text('draft_md'),
    orderIndex: integer('order_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('component_section_component_idx').on(t.componentId, t.orderIndex)],
);

/**
 * `project_qa_message` — the per-COMPONENT chat transcript.
 */
export const qaMessage = forge.table(
  'project_qa_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    componentId: uuid('component_id')
      .references(() => component.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id')
      .references(() => stage.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    sender: text('sender', { enum: QA_SENDER }).notNull(),
    bodyMd: text('body_md').notNull(),
    meta: jsonb('meta'),
    authorId: uuid('author_id').references(() => member.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('qa_message_component_seq_idx').on(t.componentId, t.seq)],
);

export type ComponentRow = typeof component.$inferSelect;
export type ComponentSectionRow = typeof componentSection.$inferSelect;
export type QaMessageRow = typeof qaMessage.$inferSelect;
