import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { stage } from '@/db/schema/projects';
import { component } from '@/db/schema/spec';
import type { StageKind } from '@/db/enums';

const PHASE_ORDER: Record<string, string[]> = {
  exploration: ['brief', 'discover', 'synthesize'],
  spec: ['outline', 'craft', 'finalize'],
  plan: ['refine', 'validate'],
  execute: ['configure', 'monitor'],
  review: ['review'],
  journal: ['journal'],
};

export async function getLastPhase(db: Db, projectId: string, stageKind: StageKind): Promise<string | null> {
  const [row] = await db
    .select({ lastPhase: stage.lastPhase })
    .from(stage)
    .where(and(eq(stage.projectId, projectId), eq(stage.kind, stageKind)))
    .limit(1);
  return row?.lastPhase ?? null;
}

/**
 * Advance lastPhase only if the new phase is forward AND the data supports it.
 * Spec 'finalize' requires all components approved.
 */
export async function advancePhase(db: Db, projectId: string, stageKind: StageKind, newPhase: string): Promise<void> {
  const order = PHASE_ORDER[stageKind];
  if (!order) return;

  const [row] = await db
    .select({ lastPhase: stage.lastPhase })
    .from(stage)
    .where(and(eq(stage.projectId, projectId), eq(stage.kind, stageKind)))
    .limit(1);

  const current = row?.lastPhase;
  const currentIdx = current ? order.indexOf(current) : -1;
  const newIdx = order.indexOf(newPhase);

  if (newIdx <= currentIdx) return;

  // Gate: spec 'finalize' requires all components approved
  if (stageKind === 'spec' && newPhase === 'finalize') {
    const [stageRow] = await db
      .select({ id: stage.id })
      .from(stage)
      .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')))
      .limit(1);
    if (stageRow) {
      const comps = await db
        .select({ status: component.status })
        .from(component)
        .where(eq(component.stageId, stageRow.id));
      const allApproved = comps.length > 0 && comps.every((c) => c.status === 'approved');
      if (!allApproved) return;
    }
  }

  await db
    .update(stage)
    .set({ lastPhase: newPhase })
    .where(and(eq(stage.projectId, projectId), eq(stage.kind, stageKind)));
}
