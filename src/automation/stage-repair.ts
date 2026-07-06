import { STAGE_ORDER, type StageKind } from '@/db/enums';
import { STAGE_FIRST_PHASE } from '@/automation/details-mutations';
import type { Details } from '@/details/schema';

/**
 * Enforce the load-bearing invariant: exactly one active stage (spec §2, AC16) AND
 * that active stage has an active phase. Called at the top of `performTransition`
 * BEFORE resolving/advancing. Mutates `d` in place; returns whether it changed.
 *   - multiple active → keep earliest, later active → pending (discard illegal jump)
 *   - zero active     → activate earliest non-done stage (reopen its first phase)
 *   - zero active, all done → leave for the completion-invariant path
 *   - one active but NO active phase → reopen its first non-done phase. This heals
 *     the initial state (an active stage whose first phase never got activated) so
 *     `allowedActions` can enter that stage's branch instead of offering nothing.
 */
export function repairActiveStage(d: Details): { changed: boolean } {
  let changed = false;
  const active = STAGE_ORDER.filter((k) => d.stages[k].status === 'active');

  if (active.length > 1) {
    for (const k of active.slice(1)) {
      d.stages[k].status = 'pending';
      for (const ph of Object.values(d.stages[k].phases as Record<string, { status: string }>)) {
        if (ph.status === 'active') ph.status = 'pending';
      }
      changed = true;
    }
  } else if (active.length === 0) {
    const firstNotDone = STAGE_ORDER.find((k) => d.stages[k].status !== 'done') as StageKind | undefined;
    if (!firstNotDone) return { changed: false };
    d.stages[firstNotDone].status = 'active';
    const first = STAGE_FIRST_PHASE[firstNotDone];
    const phases = d.stages[firstNotDone].phases as Record<string, { status: string }>;
    if (phases[first] && phases[first].status === 'pending') phases[first].status = 'active';
    return { changed: true };
  }

  // Exactly one active stage now — ensure it has an active phase. If none is active,
  // activate the first pending phase (insertion order = phase order). Skips 'done'
  // phases so a mid-stage stage reopens at the right phase, not phase 1.
  const activeStage = STAGE_ORDER.find((k) => d.stages[k].status === 'active') as StageKind | undefined;
  if (activeStage) {
    const phases = d.stages[activeStage].phases as Record<string, { status: string }>;
    const list = Object.values(phases);
    if (!list.some((p) => p.status === 'active')) {
      const firstPending = list.find((p) => p.status === 'pending');
      if (firstPending) { firstPending.status = 'active'; changed = true; }
    }
  }

  return { changed };
}
