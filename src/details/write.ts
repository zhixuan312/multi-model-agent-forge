import { eq, and } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails, type Details } from '@/details/schema';
import type { StageKind } from '@/db/enums';

export class DetailsVersionConflict extends Error {
  constructor(projectId: string) {
    super(`Optimistic lock failed for project ${projectId} after 3 retries`);
    this.name = 'DetailsVersionConflict';
  }
}

export async function updateDetails(
  db: Db,
  projectId: string,
  mutator: (d: Details) => Details,
): Promise<Details> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .select({ details: project.details, detailsVersion: project.detailsVersion })
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);

    if (!row?.details) throw new Error(`Project ${projectId} has no details`);
    const current = validateDetails(row.details);
    const updated = mutator(current);
    const validated = validateDetails(updated);

    const result = await db
      .update(project)
      .set({
        details: validated,
        detailsVersion: row.detailsVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(project.id, projectId), eq(project.detailsVersion, row.detailsVersion)))
      .returning({ id: project.id });

    if (result.length > 0) return validated;
  }
  throw new DetailsVersionConflict(projectId);
}

export async function advanceStage(
  db: Db, projectId: string, toStage: StageKind,
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    const now = new Date().toISOString();
    for (const stg of Object.values(d.stages)) {
      if (stg.status === 'active') {
        stg.status = 'done';
        if (!stg.completedAt) stg.completedAt = now;
        for (const ph of Object.values(stg.phases as Record<string, { status: string }>)) {
          if (ph.status !== 'done') ph.status = 'done';
        }
      }
    }
    const target = d.stages[toStage];
    target.status = 'active';
    if (!target.startedAt) target.startedAt = now;
    return d;
  });
}

export async function advancePhase(
  db: Db, projectId: string, stageKind: StageKind, toPhase: string,
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    const phases = d.stages[stageKind].phases as Record<string, { status: string }>;
    for (const ph of Object.values(phases)) {
      if (ph.status === 'active') ph.status = 'done';
    }
    if (phases[toPhase]) phases[toPhase].status = 'active';
    return d;
  });
}

export async function setAutomationStatus(
  db: Db, projectId: string, status: 'off' | 'running',
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    d.automation.status = status;
    if (status === 'running') {
      d.automation.startedAt = new Date().toISOString();
      d.automation.stoppedAt = undefined;
    } else {
      d.automation.stoppedAt = new Date().toISOString();
    }
    return d;
  });
}

export async function setBriefText(
  db: Db, projectId: string, text: string,
): Promise<Details> {
  return updateDetails(db, projectId, (d) => {
    d.stages.exploration.phases.brief.text = text;
    d.stages.exploration.phases.brief.status = 'done';
    return d;
  });
}
