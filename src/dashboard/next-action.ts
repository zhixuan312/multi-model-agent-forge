import type { ProjectPhase, StageKind } from '@/db/enums';

/**
 * The derived "what should I do next?" for a project. A pure function of the
 * project's gate state — the heart of the control tower. Blockers (a human gate,
 * an open audit finding) always win over plain stage progress.
 */
export type NextActionTone = 'attention' | 'normal' | 'info' | 'done';

export interface NextAction {
  label: string;
  tone: NextActionTone;
}

export interface NextActionInput {
  phase: ProjectPhase;
  currentStage: StageKind | null;
  /** Spec sections where the AI gate is satisfied but the human gate is not. */
  awaitingHuman: number;
  /** Open findings on the latest audit pass (verdict = revised). */
  openAuditIssues: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function deriveNextAction(i: NextActionInput): NextAction {
  // Blockers first — a decision the human owes the flow.
  if (i.awaitingHuman > 0) {
    return { label: `Review — ${plural(i.awaitingHuman, 'section')} need you`, tone: 'attention' };
  }
  if (i.openAuditIssues > 0) {
    return { label: `Resolve ${plural(i.openAuditIssues, 'audit finding')}`, tone: 'attention' };
  }
  // Otherwise, the stage-driven next step.
  switch (i.phase) {
    case 'done':
      return { label: 'Done', tone: 'done' };
    case 'build':
      return { label: 'Build running', tone: 'info' };
    case 'frozen':
      return { label: 'Start the build', tone: 'normal' };
    case 'design':
      return i.currentStage === 'spec'
        ? { label: 'Continue spec', tone: 'normal' }
        : { label: 'Continue exploration', tone: 'normal' };
  }
}
