import type { StageKind, ProjectPhase } from '@/db/enums';

/**
 * `stage_kind` → URL-segment map. The SINGLE source of truth — the `[id]` redirect
 * and the StageStepper link hrefs both go through it.
 *
 * Every project URL reads `{stage}?phase={phase}`, and `{stage}` is the stage's
 * DISPLAY name (see STAGE_LABEL), not its database `stage_kind`. Two kinds differ
 * from their column value: `exploration` shows as Explore and `journal` shows as
 * Reflect — so the Reflect stage's summary view is
 * `/projects/<id>/reflect?phase=summary`, never `/journal?phase=summary`, which
 * read as a different feature entirely (there is also a team-level `/journal`).
 */
export const STAGE_ROUTE: Record<StageKind, string> = {
  exploration: 'explore',
  spec: 'spec',
  plan: 'plan',
  execute: 'execute',
  review: 'review',
  journal: 'reflect',
};

/** Build the absolute stage URL for a project (`/projects/<id>/<segment>`). */
export function stageRoute(kind: StageKind, projectId: string): string {
  return `/projects/${projectId}/${STAGE_ROUTE[kind]}`;
}

/**
 * `project.phase` → `data-phase` CSS token. Three stepper groups map to two
 * visual worlds: design (warm) and build/learn (cool).
 */
export const DATA_PHASE: Record<ProjectPhase, 'design' | 'build'> = {
  design: 'design',
  build: 'build',
  learn: 'build',
  completed: 'build',
} as const;
