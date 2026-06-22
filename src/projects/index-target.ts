import type { ProjectPhase, StageKind } from '@/db/enums';
import { stageRoute } from '@/projects/stage-route';

/**
 * The project-index redirect target (Spec 3 flow 3 / Spec 7 F11). Routes to
 * the current stage via `STAGE_ROUTE`.
 */
export function projectIndexTarget(
  _projectId: string,
  _phase: ProjectPhase,
  currentStage: StageKind,
): string {
  return stageRoute(currentStage, _projectId);
}
