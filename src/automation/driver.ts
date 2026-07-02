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

      let lastErr: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await executeAction(projectId, action, db);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (attempt < 3) {
            const retryNote = `${action.note} (retry ${attempt}/3 — ${lastErr})`;
            await db.update(project).set({ autoNote: retryNote, updatedAt: new Date() }).where(eq(project.id, projectId));
            projectEventBus.publish(projectId, { type: 'automation.progress', note: retryNote });
            await sleep(5000 * attempt);
          }
        }
      }
      if (lastErr) {
        await db.update(project).set({ autoMode: false, autoNote: `Failed after 3 attempts: ${lastErr}`, updatedAt: new Date() }).where(eq(project.id, projectId));
        projectEventBus.publish(projectId, { type: 'automation.error', error: lastErr });
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
