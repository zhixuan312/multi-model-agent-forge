import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { stage } from '@/db/schema/projects';
import { component, componentSection } from '@/db/schema/spec';
import type { ComponentSectionRow, ComponentRow } from '@/db/schema/spec';
import type { ComponentKind, ComponentStatus } from '@/db/enums';
import { readExplorationSummaryAsync } from '@/projects/project-files';
import { COMPONENT_TEMPLATES } from '@/spec/components';

/**
 * Spec orchestrator — component lifecycle helpers for the Craft + Outline phases.
 *
 * - `confirmComponents` — Outline phase: create components + sections from template
 * - `onHumanSatisfied` — Craft phase: per-component approval (nod)
 * - `allComponentsApproved` — assemble gate
 * - `getLatestExploration` — grounding helper for prompts
 */

export interface OrchestratorDeps {
  db?: Db;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

interface SectionContext {
  section: ComponentSectionRow;
  component: ComponentRow;
}

async function loadSectionContext(db: Db, sectionId: string): Promise<SectionContext> {
  const [section] = await db
    .select()
    .from(componentSection)
    .where(eq(componentSection.id, sectionId))
    .limit(1);
  if (!section) throw new Error(`No component_section '${sectionId}'.`);
  const [comp] = await db
    .select()
    .from(component)
    .where(eq(component.id, section.componentId))
    .limit(1);
  if (!comp) throw new Error(`No component '${section.componentId}'.`);
  return { section, component: comp };
}

/* ── Grounding ────────────────────────────────────────────────────────── */

/** Read the exploration brief from file for grounding. */
export async function getLatestExploration(
  projectId: string,
): Promise<{ bodyMd: string } | null> {
  const bodyMd = await readExplorationSummaryAsync(projectId);
  return bodyMd ? { bodyMd } : null;
}

/* ── Component lifecycle ──────────────────────────────────────────────── */

/**
 * The human nod ("Looks good") — sets human_satisfied + advances to approved.
 */
export async function onHumanSatisfied(deps: OrchestratorDeps, sectionId: string): Promise<void> {
  const db = deps.db ?? getDb();
  const ctx = await loadSectionContext(db, sectionId);
  const nextStatus: ComponentStatus = 'approved';
  await db
    .update(component)
    .set({ humanSatisfied: true, status: nextStatus, updatedAt: new Date() })
    .where(eq(component.id, ctx.section.componentId));
}

/* ── Outline confirm: create components + sections ──────────────────── */

/**
 * Create one `component` per selected kind + one `component_section` per template
 * section (status 'gathering', order_index from template order). Additive: skips
 * kinds that already exist for the stage (re-open is additive, no duplicates).
 */
export async function confirmComponents(
  db: Db,
  stageId: string,
  kinds: ComponentKind[],
): Promise<void> {
  const existing = await db
    .select({ id: component.id, kind: component.kind, status: component.status })
    .from(component)
    .where(eq(component.stageId, stageId));

  const approvedKinds = new Set(existing.filter((e) => e.status === 'approved').map((e) => e.kind));
  const toDelete = existing.filter((e) => e.status !== 'approved').map((e) => e.id);

  if (toDelete.length > 0) {
    await db.delete(component).where(inArray(component.id, toDelete));
  }
  const approvedToRemove = existing.filter((e) => e.status === 'approved' && !kinds.includes(e.kind as ComponentKind)).map((e) => e.id);
  if (approvedToRemove.length > 0) {
    await db.delete(component).where(inArray(component.id, approvedToRemove));
  }

  const ordered = COMPONENT_TEMPLATES.filter((t) => kinds.includes(t.kind) && !approvedKinds.has(t.kind));
  for (let i = 0; i < ordered.length; i += 1) {
    const tpl = ordered[i];
    const orderIndex = COMPONENT_TEMPLATES.findIndex((t) => t.kind === tpl.kind);
    await db.transaction(async (tx) => {
      const [comp] = await tx
        .insert(component)
        .values({
          stageId,
          kind: tpl.kind,
          primaryRoles: tpl.primaryRoles,
          status: 'gathering',
          orderIndex,
        })
        .returning({ id: component.id });
      await tx.insert(componentSection).values(
        tpl.sections.map((s, si) => ({
          componentId: comp.id,
          key: s.key,
          label: s.label,
          orderIndex: si,
        })),
      );
    });
  }
}

/** True iff every component of the stage is `approved` (assemble gate). */
export async function allComponentsApproved(db: Db, stageId: string): Promise<boolean> {
  const comps = await db
    .select({ status: component.status })
    .from(component)
    .where(eq(component.stageId, stageId));
  return comps.length > 0 && comps.every((c) => c.status === 'approved');
}
