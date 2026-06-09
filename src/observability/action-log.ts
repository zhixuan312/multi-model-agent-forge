import { getDb, type Db } from '@/db/client';
import { actionLog } from '@/db/schema/audit';

/**
 * `logAction` (Spec 3 flow 5) — append one `action_log` row, the domain
 * accountability trail. The single sink for every project mutation
 * (`create_project`, `change_visibility`, `change_repos`; later specs add more).
 *
 * Distinct from the operational `logEvent` logger. `projectId` is nullable
 * (team-level actions have no project). Accepts an optional `db` so callers can
 * pass a transaction handle — the audit insert is then ATOMIC with its mutation
 * (a partial failure rolls both back; no mutation ever lands without its row).
 */
export interface LogActionInput {
  projectId: string | null;
  memberId: string;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown> | null;
}

export async function logAction(
  input: LogActionInput,
  db: Db = getDb(),
): Promise<void> {
  await db.insert(actionLog).values({
    projectId: input.projectId,
    memberId: input.memberId,
    action: input.action,
    target: input.target ?? null,
    meta: input.meta ?? null,
  });
}
