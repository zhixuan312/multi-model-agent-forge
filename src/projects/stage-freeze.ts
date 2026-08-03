import type { StageKind } from '@/db/enums';

/**
 * The stage freeze rule, as pure data-in/data-out.
 *
 * It lived inside `getStagePermissions`, which is DB-bound and async — so the governance
 * StageFlowDemo, which has no project, could not call it and wrote the rule out a second
 * time, six lock-reason strings and all, under a comment claiming it computed the rule
 * "exactly as src/projects/stage-gate.ts". Two spellings of one rule, one of them unable
 * to notice when the other changed.
 *
 * This module is deliberately free of DB imports so a `'use client'` surface can read it.
 */

export interface StagePerm {
  canMutate: boolean;
  /** Why the stage is read-only. Surfaced by AutomationBar; set iff !canMutate. */
  reason?: string;
}

export interface StagePermissions {
  explore: StagePerm;
  spec: StagePerm;
  plan: StagePerm;
  execute: StagePerm;
  review: StagePerm;
  journal: StagePerm;
}

/** How far the project has got — the only inputs the freeze rule reads. */
export interface StageProgress {
  executeStarted: boolean;
  executeDone: boolean;
  reviewDone: boolean;
  journalDone: boolean;
}

/** Every stage read-only for one reason (a completed project). */
export function allStagesLocked(reason: string): StagePermissions {
  const locked = { canMutate: false, reason };
  return { explore: locked, spec: locked, plan: locked, execute: locked, review: locked, journal: locked };
}

/** Every stage editable — a project with no recorded stage details yet. */
export function allStagesOpen(): StagePermissions {
  const open = { canMutate: true };
  return { explore: open, spec: open, plan: open, execute: open, review: open, journal: open };
}

/**
 * The rule: the design stages (Explore · Spec · Plan) freeze once execution starts, and
 * Execute / Review / Journal each freeze once they are themselves done.
 */
export function stagePermissionsFrom(p: StageProgress): StagePermissions {
  const designLocked = p.executeStarted;
  const designReason = p.executeDone ? 'Locked — execution has completed.' : 'Locked — execution is in progress.';
  const design: StagePerm = { canMutate: !designLocked, ...(designLocked && { reason: designReason }) };
  return {
    explore: design,
    spec: design,
    plan: design,
    execute: { canMutate: !p.executeDone, ...(p.executeDone && { reason: 'Locked — execution is complete.' }) },
    review: { canMutate: !p.reviewDone, ...(p.reviewDone && { reason: 'Locked — review is complete.' }) },
    journal: { canMutate: !p.journalDone, ...(p.journalDone && { reason: 'Locked — journal is complete.' }) },
  };
}

/** `stage_kind` → its key in `StagePermissions`. Only `exploration` differs. */
export function permKeyFor(kind: StageKind): keyof StagePermissions {
  return kind === 'exploration' ? 'explore' : kind;
}
