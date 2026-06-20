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
 * Spec-stage authoring tables (schema.md §5 / Spec 4). The per-section dynamic
 * Q&A produces drafted sub-sections, which Assemble concatenates into one
 * `artifact(kind='spec')` (see `artifacts.ts`).
 *
 * `component_status` is reused at BOTH the component and section level: a section
 * walks gathering→satisfied→drafted→approved; a component's status is the roll-up
 * of its sections (all approved ⇒ approved; else the lowest). `component.status`
 * is DERIVED — never written directly; recomputed on every section change.
 */

/**
 * `project_component` (schema.md §5) — a top-level section of the spec, a group of
 * sub-sections. One row per selected `COMPONENT_TEMPLATES` kind. `primary_roles`
 * is the advisory discipline-hint array (rendered as `RoleChip`s). `status` is
 * the derived roll-up.
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
    orderIndex: integer('order_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('component_stage_idx').on(t.stageId, t.orderIndex)],
);

/**
 * `project_component_section` (schema.md §5) — the SUB-component, the unit the user
 * verifies. Carries the **dual gate** flags: `ai_satisfied` (model-set) +
 * `human_satisfied` (human-set) → `approved` only when BOTH (or `forced`).
 * `draft_md` is the drafted body; `stale` marks a draft whose grounding changed
 * (an `intent_md` edit) and which re-drafts lazily on next entry.
 */
export const componentSection = forge.table(
  'project_component_section',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    componentId: uuid('component_id')
      .notNull()
      .references(() => component.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // section key from the template (e.g. options, delta, unit)
    label: text('label').notNull(),
    status: text('status', { enum: COMPONENT_STATUS }).notNull().default('gathering'),
    aiSatisfied: boolean('ai_satisfied').notNull().default(false), // the AI gate
    humanSatisfied: boolean('human_satisfied').notNull().default(false), // the human gate
    forced: boolean('forced').notNull().default(false), // force-advanced over the AI
    draftMd: text('draft_md'), // the drafted sub-section; NULL until drafted
    stale: boolean('stale').notNull().default(false), // grounding changed → re-draft on next entry
    orderIndex: integer('order_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('component_section_component_idx').on(t.componentId, t.orderIndex)],
);

/**
 * `project_qa_message` — the per-COMPONENT chat transcript. `seq` orders
 * within the component; `sender` is `forge` or `member`. `meta` carries
 * structured data (questions array, assessment). `author_id` is set for
 * member turns.
 */
export const qaMessage = forge.table(
  'project_qa_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    componentId: uuid('component_id')
      .notNull()
      .references(() => component.id, { onDelete: 'cascade' }),
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
