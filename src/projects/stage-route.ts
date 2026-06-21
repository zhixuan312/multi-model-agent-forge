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
  journal: 'journal',
};

/** Build the absolute stage URL for a project (`/projects/<id>/<segment>`). */
export function stageRoute(kind: StageKind, projectId: string): string {
  return `/projects/${projectId}/${STAGE_ROUTE[kind]}`;
}

/**
 * `project.phase` → `data-phase` value (Spec 3 flow 3). The CSS token set has
 * two visual worlds (`design | build`) mapped from `project.phase`.
 * `done` reuses Build's cool palette.
 */
export const DATA_PHASE: Record<ProjectPhase, 'design' | 'build'> = {
  design: 'design',
  frozen: 'design',
  build: 'build',
  done: 'build',
} as const;
