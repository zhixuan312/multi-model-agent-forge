import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import type { StageKind } from '@/db/enums';
import { getCurrentPhase } from '@/details/read';
import { validateDetails } from '@/details/schema';

/**
 * The stage's ACTIVE phase, or null when it has none (a skipped stage, or one whose
 * phases are all settled). Named for what it returns: it was `getLastPhase`, which reads
 * as "the most recently completed phase" — a different phase entirely for a stage in
 * flight, and the pages use it to decide which phase to land on.
 */
export async function getActivePhase(db: Db, projectId: string, stageKind: StageKind): Promise<string | null> {
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return null;
  const d = validateDetails(row.details);
  return getCurrentPhase(d, stageKind);
}
