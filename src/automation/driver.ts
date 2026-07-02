import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project } from '@/db/schema/projects';
import { projectEventBus } from '@/sse/event-bus';
import { resolveNextAction } from '@/automation/resolver';
import { executeAction } from '@/automation/actions';

const activeDrivers = new Map<string, boolean>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function driveProject(projectId: string): Promise<void> {
  if (activeDrivers.get(projectId)) return;
  activeDrivers.set(projectId, true);
  const db = getDb();

  try {
    while (true) {
      const [proj] = await db
        .select({ autoMode: project.autoMode })
        .from(project)
        .where(eq(project.id, projectId))
        .limit(1);
      if (!proj?.autoMode) return;

      const action = await resolveNextAction(projectId, db);

      if (action.kind === 'complete') {
        await db.update(project).set({ autoMode: false, autoNote: 'Project complete' }).where(eq(project.id, projectId));
        return;
      }

      if (action.kind === 'wait') {
        await sleep(5000);
        continue;
      }

      await db.update(project).set({ autoNote: action.note, updatedAt: new Date() }).where(eq(project.id, projectId));
      projectEventBus.publish(projectId, { type: 'automation.progress', note: action.note });

      try {
        await executeAction(projectId, action, db);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.update(project).set({ autoMode: false, autoNote: `Error: ${msg}`, updatedAt: new Date() }).where(eq(project.id, projectId));
        projectEventBus.publish(projectId, { type: 'automation.error', error: msg });
        return;
      }

      await sleep(1000);
    }
  } finally {
    activeDrivers.delete(projectId);
  }
}

export function isDriverRunning(projectId: string): boolean {
  return activeDrivers.get(projectId) ?? false;
}
