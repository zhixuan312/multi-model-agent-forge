import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { stage } from '@/db/schema/projects';
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

  if (newIdx > currentIdx) {
    await db
      .update(stage)
      .set({ lastPhase: newPhase })
      .where(and(eq(stage.projectId, projectId), eq(stage.kind, stageKind)));
  }
}
