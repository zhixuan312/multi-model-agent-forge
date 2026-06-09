import type { StageKind, ProjectPhase } from '@/db/enums';

/**
 * `stage_kind` → URL-segment map (Spec 3 Data model, the one divergence).
 *
 * Only `exploration` diverges from its value (`explore`); every other kind's
 * segment is identical. This is the SINGLE source of truth — the `[id]` redirect
 * and the StageStepper link hrefs both go through it, so a fresh project
 * redirects to `/projects/<id>/explore` (never `/exploration`, which has no
 * route file and would 404).
 */
export const STAGE_ROUTE: Record<StageKind, string> = {
  exploration: 'explore', // the ONLY divergence
  spec: 'spec',
  plan: 'plan',
  execute: 'execute',
  review: 'review',
};

/** Build the absolute stage URL for a project (`/projects/<id>/<segment>`). */
export function stageRoute(kind: StageKind, projectId: string): string {
  return `/projects/${projectId}/${STAGE_ROUTE[kind]}`;
}

/**
 * `project.phase` → `data-phase` value (Spec 3 flow 3). The CSS token set has
 * three phase worlds (`design | frozen | build`) while `project.phase` has four;
 * `done` reuses Build's cool palette (no distinct `done` palette in this slice).
 */
export const DATA_PHASE: Record<ProjectPhase, 'design' | 'frozen' | 'build'> = {
  design: 'design',
  frozen: 'frozen',
  build: 'build',
  done: 'build',
} as const;
