import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { project } from '@/db/schema/projects';

/**
 * The projects whose automation should resume after a server restart.
 *
 * Requires BOTH signals, and that is the whole point. The boot sweep used to ask for
 * `autoMode = true` OR `details.automation.status = 'running'`, under a comment calling
 * `autoMode` the legacy field. It is not legacy — `driver.ts` re-reads it every iteration
 * and returns the moment it is false, so it is the live kill switch. The two writes are
 * separate statements, and the OR mishandled each window between them:
 *
 *  - `autoMode = true` with status `off` is the crash window inside `take_over`, which sets
 *    the status first. Resuming there restarts automation a human just stopped — the exact
 *    outcome the cooperative-cancel work exists to prevent, arriving via a restart instead.
 *  - status `running` with `autoMode = false` is the reverse window. `driveProject` starts,
 *    reads `autoMode`, and returns immediately — so the sweep logged
 *    `startup.automation_resumed` for a project that resumed nothing.
 *
 * Requiring both means a half-written stop stays stopped and a half-written start stays
 * stopped. Failing closed is right for automation that commits to a branch: the cost of not
 * resuming is one click, and the cost of resuming wrongly is unattended work on a project
 * someone had taken back.
 */
export async function listResumableProjects(db: Db): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(
      and(
        eq(project.autoMode, true),
        sql`${project.details}->'automation'->>'status' = 'running'`,
      ),
    );
}
