import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import type { StageKind } from '@/db/enums';
import { advancePhase as advancePhaseDetails } from '@/details/write';
import { getCurrentPhase } from '@/details/read';
import { validateDetails } from '@/details/schema';

const PHASE_ORDER: Record<string, string[]> = {
  exploration: ['brief', 'discover', 'synthesize'],
  spec: ['outline', 'craft', 'finalize'],
  plan: ['refine', 'validate'],
  execute: ['configure', 'implement'],
  review: ['review'],
  journal: ['journal', 'summary'],
};

export async function getLastPhase(db: Db, projectId: string, stageKind: StageKind): Promise<string | null> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return null;
  const d = validateDetails(row.details);
  return getCurrentPhase(d, stageKind);
}

export async function advancePhase(db: Db, projectId: string, stageKind: StageKind, newPhase: string): Promise<void> {
  const order = PHASE_ORDER[stageKind];
  if (!order || !order.includes(newPhase)) return;
  await advancePhaseDetails(db, projectId, stageKind, newPhase);
}
