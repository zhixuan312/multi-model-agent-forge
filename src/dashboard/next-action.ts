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
  /** Spec components with no approval yet. (There is no AI-gate flag in details to read.) */
  awaitingHuman: number;
  /** Audited stages whose LATEST pass came back `revised` — 0, 1 or 2. Not a finding count. */
  auditsNeedingFix: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function deriveNextAction(i: NextActionInput): NextAction {
  // Blockers first — a decision the human owes the flow.
  if (i.awaitingHuman > 0) {
    // `need`/`needs` agrees with the count — one section "need you" was the copy that
    // shipped, and its test asserted the broken string.
    const verb = i.awaitingHuman === 1 ? 'needs' : 'need';
    return { label: `Review — ${plural(i.awaitingHuman, 'section')} ${verb} you`, tone: 'attention' };
  }
  if (i.auditsNeedingFix > 0) {
    // Not `${n} audit findings`: this counts STAGES, capped at two, so a spec pass with
    // twelve findings read "Resolve 1 audit finding". Details stores no finding count,
    // so the honest label carries no number at all.
    return { label: 'Resolve audit findings', tone: 'attention' };
  }
  // Otherwise, the stage-driven next step.
  switch (i.phase) {
    case 'completed':
      return { label: 'Completed', tone: 'done' };
    case 'learn':
      return { label: 'Learn', tone: 'done' };
    case 'build':
      return { label: 'Build running', tone: 'info' };
    case 'design':
      return i.currentStage === 'spec'
        ? { label: 'Continue spec', tone: 'normal' }
        : { label: 'Continue exploration', tone: 'normal' };
  }
}
