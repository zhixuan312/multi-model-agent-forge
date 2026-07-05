import { STAGE_ORDER, type StageKind } from '@/db/enums';
import { STAGE_FIRST_PHASE } from '@/automation/details-mutations';
import type { Details } from '@/details/schema';

/**
 * Enforce the load-bearing invariant: exactly one active stage (spec §2, AC16).
 * Called at the top of `performTransition` BEFORE resolving/advancing. Mutates `d`
 * in place; returns whether it changed anything.
 *   - multiple active → keep earliest, later active → pending (discard illegal jump)
 *   - zero active     → activate earliest non-done stage (reopen its first phase)
 *   - zero active, all done → leave for the completion-invariant path
 */
export function repairActiveStage(d: Details): { changed: boolean } {
  const active = STAGE_ORDER.filter((k) => d.stages[k].status === 'active');
  if (active.length === 1) return { changed: false };

  if (active.length > 1) {
    let changed = false;
    for (const k of active.slice(1)) {
      d.stages[k].status = 'pending';
      for (const ph of Object.values(d.stages[k].phases as Record<string, { status: string }>)) {
        if (ph.status === 'active') ph.status = 'pending';
      }
      changed = true;
    }
    return { changed };
  }

  // zero active
  const firstNotDone = STAGE_ORDER.find((k) => d.stages[k].status !== 'done') as StageKind | undefined;
  if (!firstNotDone) return { changed: false };
  d.stages[firstNotDone].status = 'active';
  const first = STAGE_FIRST_PHASE[firstNotDone];
  const phases = d.stages[firstNotDone].phases as Record<string, { status: string }>;
  if (phases[first] && phases[first].status === 'pending') phases[first].status = 'active';
  return { changed: true };
}
