import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import type { StageKind } from '@/db/enums';
import { getCurrentPhase } from '@/details/read';
import { validateDetails } from '@/details/schema';

export async function getLastPhase(db: Db, projectId: string, stageKind: StageKind): Promise<string | null> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return null;
  const d = validateDetails(row.details);
  return getCurrentPhase(d, stageKind);
}
