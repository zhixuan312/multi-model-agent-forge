import type { ProjectPhase, StageKind } from '@/db/enums';
import { stageRoute } from '@/projects/stage-route';

/**
 * The project-index redirect target (Spec 3 flow 3 / Spec 7 F11). A `build`- or
 * `done`-phase project goes straight to the unified build monitor (`/build`);
 * any other phase routes to its current stage via `STAGE_ROUTE`.
 */
export function projectIndexTarget(
  projectId: string,
  phase: ProjectPhase,
  currentStage: StageKind,
): string {
  if (phase === 'build' || phase === 'done') {
    return `/projects/${projectId}/build`;
  }
  return stageRoute(currentStage, projectId);
}
